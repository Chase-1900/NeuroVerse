# NeuroVerse 前端 · 角色 A

## 本地运行

需要 Node.js 22.13 或更高版本，推荐 Node.js 24。以下命令在 `frontend/` 中运行：

```sh
npm ci
npm run dev
```

启动后打开 Vite 输出的地址。首页选择「浏览离线示例」，无需角色 B 的服务即可演示图谱、TXT / 粘贴导入、档案、增删改、碰撞保存和导师练习。示例数据保存在当前浏览器，本地模拟不解析 PDF、不调用真实模型。可用导航栏右侧按钮切换数据模式。

## 路由与架构

| 路由 | 页面 |
| --- | --- |
| `/` | 意识入口与图谱概况 |
| `/universe` | 三维知识宇宙、图谱搜索、星球操作与碰撞 |
| `/archive?document=…&chunk=…` | 资料列表、原文和切片链接 |
| `/tutor?node=…` | AI 导师与主题复习 |

React Router 管理路由；TanStack Query 管理共享图谱缓存；筛选、选中、视图和表单在页面内管理。`src/api/` 提供遵循共享 OpenAPI 的请求层与隔离的本地示例适配器。`src/types/graph.ts` 将只读 DTO 转为渲染副本；Three.js / `3d-force-graph` 场景按需加载。样式使用 Tailwind CSS 与 CSS 设计变量。部署静态前端时，页面路由需要回退到 `index.html`，API 路由则由服务处理。

## 角色 B 联调

复制 `.env.example` 为 `.env.local`，将 `VITE_API_BASE_URL` 设为角色 B 服务地址，不含 `/api/v1`；真实模式默认使用 `http://localhost:8000`。保持 `VITE_DEMO_MODE=false` 并从导航切到真实模式。真实 API 与示例数据互不替换，禁止在 `VITE_*` 中写密钥。

## 检查

```sh
npm run lint
npm test
npm run test:e2e
npm run build
```

端到端测试使用系统安装的 Google Chrome。真实服务联调、Safari 实机与 100 节点性能验收仍需执行；示例通过不等于 P0 发布验收完成。详见 [功能与验收](功能与验收.md) 和 [长期规则](AGENTS.md)。
