# NeuroVerse · 赛博思维宫殿

用三维知识图谱探索资料、连接想法，并借助 AI 导师复习。后端可按下文启动；前端目前处于结构与文档阶段。

- [前端目录与开发顺序](frontend/README.md) · [角色 A 开发规则](frontend/AGENTS.md) · [功能与验收清单](frontend/功能与验收.md)
- [角色 A 原始规范](NeuroVerse_角色A_AI开发需求规范.md) · [角色 B 原始规范](NeuroVerse_角色B_AI开发需求规范.md)
- [共享 API 契约](contracts/openapi.yaml) · [共享图谱样例](fixtures/graph.json)

角色 A 负责 `frontend/`，角色 B 负责 `backend/`。接口变更须由双方确认。`reference_assets/` 中的图片仅供视觉参考，不是页面实现。

## 后端本地启动

使用 Python 3.12，在 `backend` 目录下操作：

```bash
python -m venv .venv
# 激活虚拟环境：Git Bash 用 source .venv/Scripts/activate；Linux/macOS 用 source .venv/bin/activate
python -m pip install -r requirements-dev.txt
alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

另开终端执行 `curl http://127.0.0.1:8000/health`，应返回 `{"status":"ok"}`。运行全部后端测试：`python -m pytest`。

配置见 `backend/.env.example`，需要把变量设到进程环境，服务不会自动读取 `.env`。默认 SQLite 数据库为 `backend/data/neuroverse.db`，迁移必须在启动前运行。只在 `APP_ENV=development` 时允许配置中的前端 Origin，生产同源。

按 `contracts/openapi.yaml` 向 `POST /api/v1/sessions` 发送 JSON `{}` 获取会话令牌，后续用 `Authorization: Bearer <sessionToken>` 认证。`GET /api/v1/graph` 返回该会话的图谱和版本。文件导入用 multipart `file` 或 `text`（二选一），轮询 `GET /api/v1/jobs/{id}`；成功后重新获取图谱。PDF 仅支持文本层，不做 OCR。上传资料前须明确告知用户选用的模型服务会接收文本，并确认资料可用于该处理。

## 配置真实模型与部署

- 将供应商兼容 API 的基础地址、密钥和模型标识分别设为 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL`。基础地址应包括供应商规定的版本路径，但不含 `/chat/completions`。未配置时仍可运行会话和图谱，AI 请求会明确失败，不会用模拟结果替代。测试模型只能在 `APP_ENV=test` 时注入。
- 生产使用 `APP_ENV=production`、HTTPS 模型端点，并由反向代理提供同源 HTTPS，限制上传请求大小、连接数和公开会话创建速率。将 SQLite 数据放到可写持久化目录，用 SQLite 在线备份或停服快照做备份。不要记录会话令牌、密钥、资料原文或用户答案。
- 发布前执行 `python -m pip install -r requirements.txt` 和 `python -m alembic upgrade head`，然后以 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log` 启动。不要启用 reload 或多 worker；导入执行器和限流按单实例设计。部署后先验 `/health`，再用获准公开的小样本验真实模型、图谱来源和角色 A 联调。
- 基础复习推荐已通过原契约的 `reviewNodeIds` 提供，排序规则为相邻知识节点的掌握度由低到高。快照和分享的 API 尚未共同确认，不对外开放。

开发与验收记录见 `COMPETITION_EVIDENCE.md`。
