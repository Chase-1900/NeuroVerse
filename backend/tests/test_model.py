import httpx
import json
import pytest
from pydantic import BaseModel

from app.core import APIError
from app.model import AILimit, ModelProvider


class Output(BaseModel):
    title: str


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv('LLM_BASE_URL', 'https://model.example.invalid/v1')
    monkeypatch.setenv('LLM_API_KEY', 'fake-test-key')
    monkeypatch.setenv('LLM_MODEL', 'fake-test-model')
    monkeypatch.setattr('app.model.time.sleep', lambda _: None)
    adapter = ModelProvider()
    try:
        yield adapter
    finally:
        adapter.close()


def simulate(provider, responses):
    sent = []
    responses = iter(responses)

    def send(request):
        sent.append(request)
        response = next(responses)
        if isinstance(response, Exception):
            raise response
        return response

    provider.client.close()
    provider.client = httpx.Client(transport=httpx.MockTransport(send))
    return sent


def model_output(content):
    return httpx.Response(200, json={'choices': [{'message': {'content': content}}]})


def test_chat_request_explicitly_disables_streaming(provider):
    sent = simulate(provider, [model_output('{"title":"TCP"}')])
    assert provider.complete_json('Extract', {'text': 'TCP'}, Output).title == 'TCP'
    payload = json.loads(sent[0].content)
    assert payload['stream'] is False


def test_transient_errors_retry_then_validate_output(provider):
    sent = simulate(provider, [httpx.ReadTimeout('private'), httpx.Response(429), model_output('{"title":"TCP"}')])
    assert provider.complete_json('Extract', {'text': 'TCP'}, Output).title == 'TCP'
    assert len(sent) == 3
    assert sent[0].url.path == '/v1/chat/completions'
    assert sent[0].headers['Authorization'] == 'Bearer fake-test-key'


def test_invalid_json_uses_only_one_repair_and_hides_output(provider):
    sent = simulate(provider, [model_output('hidden internal result'), model_output('still invalid')])
    with pytest.raises(APIError) as failure:
        provider.complete_json('Extract', {}, Output)
    assert len(sent) == 2
    assert failure.value.status_code == 502
    assert 'hidden' not in failure.value.message


def test_nontransient_error_is_not_retried(provider):
    sent = simulate(provider, [httpx.Response(403, text='hidden upstream error')])
    with pytest.raises(APIError) as failure:
        provider.complete_json('Extract', {}, Output)
    assert len(sent) == 1
    assert failure.value.status_code == 502
    assert 'hidden' not in failure.value.message


def test_dashscope_retries_nonstreaming_thinking_rejection(provider, caplog):
    import json

    provider.base_url = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    sent = simulate(provider, [httpx.Response(400, json={'error': {
        'code': 'InvalidParameter', 'message': 'enable_thinking must be set to false for non-streaming calls; private detail',
    }}), model_output('{"title":"TCP"}')])
    assert provider.complete_json('Extract', {}, Output).title == 'TCP'
    assert len(sent) == 2
    assert 'enable_thinking' not in json.loads(sent[0].content)
    assert json.loads(sent[1].content)['enable_thinking'] is False
    assert 'reason=thinking_requires_stream_or_disabled' in caplog.text
    assert 'private detail' not in caplog.text


def test_failure_logs_only_safe_diagnostics(provider, caplog):
    simulate(provider, [httpx.Response(401, json={'code': 'InvalidApiKey', 'message': 'private upstream body'})])
    with pytest.raises(APIError) as failure:
        provider.complete_json('private prompt', {'data': 'private input'}, Output)
    assert failure.value.status_code == 502
    assert 'stage=upstream_http status=401 provider_code=InvalidApiKey' in caplog.text
    for secret in ('private upstream body', 'private prompt', 'private input', 'fake-test-key'):
        assert secret not in caplog.text


def test_rate_limit_is_owner_scoped_and_expires(monkeypatch):
    monkeypatch.setenv('AI_REQUESTS_PER_MINUTE', '1')
    now = 100
    monkeypatch.setattr('app.model.time.monotonic', lambda: now)
    limiter = AILimit()
    limiter.check('owner-a')
    limiter.check('owner-b')
    with pytest.raises(APIError) as failure:
        limiter.check('owner-a')
    assert failure.value.status_code == 429
    now += 60
    limiter.check('owner-a')
