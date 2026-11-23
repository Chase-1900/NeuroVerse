import json
import logging
import os
import time
from collections import deque
from threading import BoundedSemaphore, Lock
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from app.core import APIError


logger = logging.getLogger('uvicorn.error')
SAFE_PROVIDER_CODES = {
    'InvalidApiKey', 'invalid_api_key', 'invalid_request_error', 'model_not_found',
    'ModelNotFound', 'AccessDenied', 'InsufficientQuota', 'insufficient_quota',
    'Arrearage', 'Throttling', 'rate_limit_exceeded', 'DataInspectionFailed',
    'InvalidParameter', 'BadRequest', 'invalid_parameter', 'bad_request',
}


def classify_upstream_message(message):
    if not isinstance(message, str):
        return 'unknown'
    message = message.casefold()
    if 'enable_thinking' in message and ('false' in message or 'stream' in message):
        return 'thinking_requires_stream_or_disabled'
    if 'max_tokens' in message:
        return 'max_tokens_rejected'
    if 'model' in message and any(text in message for text in ('not found', 'does not exist', 'no access', 'not supported')):
        return 'model_unavailable'
    if any(text in message for text in ('api key', 'api-key', 'apikey')):
        return 'credential_rejected'
    if any(text in message for text in ('overdue', 'arrearage', 'insufficient quota', 'balance')):
        return 'billing_or_quota'
    return 'unknown'


def log_upstream_failure(response):
    code = 'unknown'
    reason = 'unknown'
    try:
        raw = bytearray()
        for part in response.iter_bytes(chunk_size=4096):
            if len(raw) + len(part) > 8192:
                break
            raw.extend(part)
        else:
            body = json.loads(raw)
            if isinstance(body, dict):
                nested = body.get('error')
                details = nested if isinstance(nested, dict) else body
                candidate = details.get('code')
                if isinstance(candidate, str) and candidate in SAFE_PROVIDER_CODES:
                    code = candidate
                reason = classify_upstream_message(details.get('message'))
    except (ValueError, httpx.HTTPError):
        pass
    logger.warning('model_failure stage=upstream_http status=%d provider_code=%s reason=%s', response.status_code, code, reason)
    return reason


class AILimit:
    def __init__(self):
        self.limit = int(os.getenv('AI_REQUESTS_PER_MINUTE', '6'))
        self.lock = Lock()
        self.events = deque()
        self.counts = {}

    def check(self, owner):
        with self.lock:
            now = time.monotonic()
            while self.events and self.events[0][0] <= now - 60:
                _, expired = self.events.popleft()
                count = self.counts[expired] - 1
                if count:
                    self.counts[expired] = count
                else:
                    del self.counts[expired]
            count = self.counts.get(owner, 0)
            if count >= self.limit:
                raise APIError(429, 'RATE_LIMITED', 'AI 请求过于频繁，请稍后重试')
            self.events.append((now, owner))
            self.counts[owner] = count + 1


class ModelProvider:
    def __init__(self):
        self.base_url = os.getenv('LLM_BASE_URL', '').rstrip('/')
        self.key = os.getenv('LLM_API_KEY', '')
        self.model = os.getenv('LLM_MODEL', '')
        if self.base_url:
            url = urlsplit(self.base_url)
            if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError('LLM_BASE_URL must be an HTTP(S) base URL without credentials or query.')
            if url.scheme != 'https' and os.getenv('APP_ENV', 'production') == 'production':
                raise ValueError('LLM_BASE_URL must use HTTPS in production.')
        self.timeout = float(os.getenv('LLM_TIMEOUT_SECONDS', '60'))
        self.slots = BoundedSemaphore(int(os.getenv('LLM_MAX_CONCURRENCY', '2')))
        self.client = httpx.Client(timeout=self.timeout, follow_redirects=False, trust_env=False)

    def close(self):
        self.client.close()

    def complete_json(self, system, data, schema):
        if not all((self.base_url, self.key, self.model)):
            raise APIError(502, 'MODEL_UNAVAILABLE', '模型服务尚未配置')
        serialized = json.dumps(data, ensure_ascii=False)
        if len(serialized) > 60000:
            raise APIError(502, 'MODEL_INPUT_LIMIT', '模型输入超限')
        messages = [{'role': 'system', 'content': system + '\n仅返回符合以下 JSON Schema 的 JSON：' + json.dumps(schema.model_json_schema(), ensure_ascii=False)},
                    {'role': 'user', 'content': serialized}]
        repaired = False
        payload = {'model': self.model, 'messages': messages, 'max_tokens': 4500, 'stream': False}
        is_dashscope = urlsplit(self.base_url).hostname in {'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'}
        if not self.slots.acquire(blocking=False):
            raise APIError(503, 'SERVICE_UNAVAILABLE', '模型服务繁忙，请稍后重试')
        try:
            for attempt in range(3):
                try:
                    with self.client.stream('POST', self.base_url + '/chat/completions',
                                            headers={'Authorization': f'Bearer {self.key}'},
                                            json=payload) as result:
                        if result.status_code != 200:
                            reason = log_upstream_failure(result)
                            if (result.status_code == 400 and is_dashscope and attempt < 2
                                    and reason == 'thinking_requires_stream_or_disabled' and 'enable_thinking' not in payload):
                                payload['enable_thinking'] = False
                                continue
                            if result.status_code == 429 or result.status_code >= 500:
                                if attempt < 2:
                                    time.sleep(0.25 * 2 ** attempt)
                                continue
                            break
                        raw = bytearray()
                        for part in result.iter_bytes():
                            if len(raw) + len(part) > 262144:
                                raise ValueError('response too large')
                            raw.extend(part)
                    content = json.loads(raw)['choices'][0]['message']['content']
                    if not isinstance(content, str) or len(content) > 40000:
                        raise ValueError('invalid model output')
                    return schema.model_validate_json(content)
                except (httpx.TimeoutException, httpx.NetworkError) as error:
                    logger.warning('model_failure stage=transport kind=%s', 'timeout' if isinstance(error, httpx.TimeoutException) else 'network')
                    if attempt < 2:
                        time.sleep(0.25 * 2 ** attempt)
                except httpx.HTTPError:
                    logger.warning('model_failure stage=transport kind=http_protocol')
                    break
                except (ValueError, ValidationError, TypeError, KeyError, IndexError):
                    logger.warning('model_failure stage=response_validation')
                    if repaired or attempt == 2:
                        break
                    repaired = True
                    messages[0]['content'] += '\n上次响应未通过校验。只输出严格匹配结构的 JSON，不要添加围栏或解释。'
        finally:
            self.slots.release()
        raise APIError(502, 'MODEL_ERROR', '模型服务未返回可用结果')
