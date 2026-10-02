# Music Top

用 QQ 音乐曲库创建个人歌曲排名。曲库搜索与歌曲元数据始终来自 QQ 音乐 API，不使用演示曲库。

## 环境要求

- Node.js 22.12 或更新版本
- pnpm 11.7.0
- 访问 QQ 音乐 API 所需的网络连接

## 本地运行

```powershell
pnpm install
pnpm dev:all
```

打开 <http://localhost:5173>。`dev:all` 会并行启动 Vue 前端和 Fastify API；API 同时启动项目依赖的 QQ Music API 服务并绑定到本机回环地址。

如果要分别启动，可以在两个终端运行 `pnpm dev` 和 `pnpm dev:api`。前端默认代理 `/api` 到 `http://localhost:3001`。

本地未配置 `DATABASE_URL` 时，分享和曲库问题记录保存在 API 进程内存中，API 重启后会清空。正式运行需要 PostgreSQL；API 启动时会应用 `apps/api/migrations/001_shares.sql`。

默认内嵌的社区 QQ Music API 兼容服务监听 `127.0.0.1:3200`。可设置 `QQ_MUSIC_API_PORT` 更改本地端口，或设置 `QQ_MUSIC_API_URL` 连接外部兼容服务。无论开发或生产，曲库 provider 都使用 QQ 音乐；上游不可用时请求会报错，不会回退到其他数据源。

该社区 API 并非腾讯官方服务，其项目说明将用途限制为学习和研究，并禁止商业使用。部署前请确认上游限制及 QQ 音乐服务条款适用于你的使用场景。

## 项目命令

- `pnpm dev:all`：启动前端和 API
- `pnpm dev`：只启动前端
- `pnpm dev:api`：只启动 API（同时启动内嵌 QQ Music API 服务）
- `pnpm test`：运行测试
- `pnpm typecheck`：类型检查
- `pnpm build`：构建所有 workspace 项目
