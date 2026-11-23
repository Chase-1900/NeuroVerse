# NeuroVerse 前端 · 角色 A

当前仅建立目录骨架；空目录以 `.gitkeep` 保留。没有入口、依赖清单、运行脚本或测试实现。下一阶段按编号逐个实现，不把示例模式作为交付完成。

## 目录与归属

| 目录 | 后续放置内容 |
| --- | --- |
| `src/pages/` | `/` LandingPage、`/universe` UniversePage、`/archive` ArchivePage、`/tutor` TutorPage |
| `src/components/` | NavBar、GraphScene、GraphListFallback、NodePanel、ImportDialog、CollisionPanel、TutorPanel、ErrorState |
| `src/api/` | `client.ts` 与按图谱、导入、档案、导师、创意划分的请求封装 |
| `src/types/` | `graph.ts`、`api.ts`，按 OpenAPI 定义请求与响应类型 |
| `src/hooks/` | useGraph、useImportJob、useSelection |
| `src/styles/` | `tokens.css`、`global.css` 和组件样式 |
| `tests/unit/` | DTO 映射、错误、选中状态、掌握度显示 |
| `tests/e2e/` | 主流程、刷新持久化、错误恢复与 WebGL 降级 |

共享契约和样例保留在仓库根目录的 `contracts/`、`fixtures/`；视觉参考留在 `reference_assets/`，不进入运行时页面。

## 后续实施顺序

1. 初始化 React + TypeScript + Vite 与 React Router，提交依赖锁文件；选 TanStack Query 作为请求缓存层，使用 CSS Modules 与 CSS 变量；测试使用 Vitest 和 Playwright。
2. 先接共享 fixture 与显式示例模式，实现 A01–A02；只用基于 Three.js 的 `3d-force-graph`，不并用第二套引擎。
3. 实现 A03–A07，覆盖导入、档案、星球增删改、碰撞、导师和降级；按 [验收清单](功能与验收.md) 验证。
4. 与 B 先联调会话、图谱、导入、档案和节点，再联调碰撞与导师。真实 API 为默认模式；P0 完成前须实际验证开发启动、lint、单测、端到端测试和 `npm run build`。

初始化时提供 `frontend/.env.example`，仅声明公开变量 `VITE_API_BASE_URL`（服务地址，不含 `/api/v1`）和 `VITE_DEMO_MODE`（默认 `false`）。当前没有可执行命令；初始化完成后再补充实际运行说明。
