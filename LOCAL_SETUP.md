# Manifest 本地环境配置指南

本文档说明如何在本地开发环境中部署和运行 Manifest（智能模型路由器）。

## 前置条件

- Node.js 22.x
- npm 10.x
- Docker Desktop（用于 PostgreSQL）
- Git

## 架构概览

```
Manifest 本地架构:

  前端 (SolidJS + Vite)          后端 (NestJS)              数据库
  http://localhost:3000   →    http://localhost:3001   →   PostgreSQL :5432
       ↑ 开发代理 /api /otlp        ↑                       (hycoreai-postgres 容器)
       └─────────────────────────────┘
                                     ↑
                              LLM Proxy 端点
                         POST /v1/chat/completions
                         (OpenAI 兼容，供 Agent 调用)
```

## 步骤 1：启动 PostgreSQL

Manifest 复用 BrowserOS admin-server 的 PostgreSQL 容器。如果还没启动，先运行 admin-server 的 docker-compose：

```bash
cd packages/browseros-agent/apps/admin-server
docker compose up -d postgres redis
```

验证容器运行状态：

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}"
```

应看到：

| 容器名 | 镜像 | 端口 |
|--------|------|------|
| hycoreai-postgres | postgres:17-alpine | 0.0.0.0:5432->5432/tcp |
| hycoreai-redis | redis:7-alpine | 0.0.0.0:6379->6379/tcp |

## 步骤 2：创建 Manifest 数据库

在已有的 PostgreSQL 容器中创建专用数据库：

```bash
docker exec hycoreai-postgres psql -U hycoreai -d hycoreai_admin -c "CREATE DATABASE manifest_hycoreai;"
```

验证创建成功：

```bash
docker exec hycoreai-postgres psql -U hycoreai -d hycoreai_admin -c "\l"
```

数据库连接信息：

| 参数 | 值 |
|------|-----|
| Host | localhost |
| Port | 5432 |
| User | hycoreai |
| Password | hycoreai_secret |
| Database | manifest_hycoreai |
| 完整 URL | `postgresql://hycoreai:hycoreai_secret@localhost:5432/manifest_hycoreai` |

## 步骤 3：配置环境变量

创建 `ModelMgm/manifest/packages/backend/.env`：

```env
# ── Core（必填）──────────────────────────────────────
BETTER_AUTH_SECRET=<运行 openssl rand -hex 32 生成>
DATABASE_URL=postgresql://hycoreai:hycoreai_secret@localhost:5432/manifest_hycoreai

# ── Server ───────────────────────────────────────────
PORT=3001
BIND_ADDRESS=127.0.0.1
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3001

# ── API Key ──────────────────────────────────────────
API_KEY=dev-api-key-hycoreai-manifest

# ── Data Seeding（首次启动设为 true）─────────────────
SEED_DATA=true
```

生成 `BETTER_AUTH_SECRET`：

```bash
openssl rand -hex 32
```

## 步骤 4：安装依赖并构建 shared 包

必须从**项目根目录**安装依赖，让 npm workspaces 正确链接内部包（`manifest-shared`）：

```bash
cd ModelMgm/manifest
npm install
```

安装完成后，**必须先构建 shared 包**，否则后端编译时会报 `Cannot find module 'manifest-shared'` 错误：

```bash
cd ModelMgm/manifest/packages/shared
npm run build
```

> `manifest-shared` 的类型声明输出到 `dist/cjs/index.d.ts`，后端和前端都依赖这些构建产物。每次修改 shared 包后都需要重新构建。

## 步骤 5：启动服务

需要打开两个终端，分别启动后端和前端。

### 终端 1 — 后端（NestJS）

> 注意：必须在 `packages/backend` 目录下运行，否则 Nest 找不到 `tsconfig.json`。

**Bash / Git Bash:**

```bash
cd ModelMgm/manifest/packages/backend
NODE_OPTIONS='-r dotenv/config' npx nest start --watch
```

**PowerShell (Windows):**

```powershell
cd ModelMgm\manifest\packages\backend
$env:NODE_OPTIONS='-r dotenv/config'; npx nest start --watch
```

> PowerShell 不支持 `KEY=value command` 语法，必须用 `$env:KEY='value';` 方式设置环境变量。

后端启动时会自动：
- 运行 TypeORM migrations 创建所有数据表
- 加载 OpenRouter 模型定价缓存（~700 条）
- 如果 `SEED_DATA=true`，插入种子数据（管理员账户、示例 Agent、670 条测试消息）

### 终端 2 — 前端（Vite + SolidJS）

```bash
cd ModelMgm/manifest/packages/frontend
npx vite
```

## 步骤 6：访问 Manifest

| 地址 | 用途 |
|------|------|
| http://localhost:3000 | 前端开发服务器（Vite，带热更新） |
| http://localhost:3001 | 后端 API + 生产模式前端 |
| http://localhost:3001/api/v1/health | 健康检查端点 |

### 种子账户

首次启动（`SEED_DATA=true`）后，使用以下账户登录：

- **邮箱**: `admin@manifest.build`
- **密码**: `manifest`

> 登录后建议前往 Settings 页面修改密码。

## 生产模式构建

单服务部署，NestJS 同时提供 API 和前端静态文件：

```bash
cd ModelMgm/manifest
npm run build    # Turborepo: 先构建 frontend (Vite) 再构建 backend (Nest)
npm start        # node packages/backend/dist/main.js
```

生产模式下访问 http://localhost:3001 即可。

## 与 BrowserOS Agent 集成

Manifest 作为 LLM 代理端点，BrowserOS Agent 的 LLM 请求可以指向它实现智能路由：

```
POST http://localhost:3001/v1/chat/completions
Authorization: Bearer mnfst_<你的 Agent API Key>
```

Agent API Key 在 Manifest 仪表盘中创建 Agent 后获取。

## 数据库管理

### 查看表结构

```bash
docker exec hycoreai-postgres psql -U hycoreai -d manifest_hycoreai -c "\dt"
```

### 重置数据库

如需从头开始，删除并重新创建数据库：

```bash
docker exec hycoreai-postgres psql -U hycoreai -d hycoreai_admin -c "DROP DATABASE manifest_hycoreai;"
docker exec hycoreai-postgres psql -U hycoreai -d hycoreai_admin -c "CREATE DATABASE manifest_hycoreai;"
```

重启后端服务即可自动重建表结构和种子数据。

### 数据库迁移

```bash
cd ModelMgm/manifest/packages/backend

# 查看迁移状态
npm run migration:show

# 手动运行迁移
npm run migration:run

# 回滚最近一次迁移
npm run migration:revert
```

## 常见问题

### `Cannot find module 'manifest-shared'`

后端编译时报此错误，说明 shared 包未构建或依赖未正确链接。按顺序执行：

```bash
# 1. 在项目根目录安装依赖（链接 workspace 包）
cd ModelMgm/manifest
npm install

# 2. 构建 shared 包（生成 dist/ 类型声明）
cd packages/shared
npm run build
```

验证链接是否正确：

```bash
ls -la node_modules/manifest-shared
# 应显示指向 packages/shared 的符号链接
```

### 后端启动报 `BETTER_AUTH_SECRET` 错误

`auth.instance.ts` 在模块加载时就读取 `process.env`，早于 NestJS 的 ConfigModule。必须通过 `NODE_OPTIONS='-r dotenv/config'` 预加载 dotenv。

### 后端报 `Could not find TypeScript configuration file "tsconfig.json"`

在错误的目录下运行了 `nest start`。必须在 `packages/backend` 目录下执行，不能在 `packages/` 或项目根目录。

### PowerShell 报 `NODE_OPTIONS=-r dotenv/config: The term is not recognized`

PowerShell 不支持 Unix 的 `KEY=value command` 语法。使用：

```powershell
$env:NODE_OPTIONS='-r dotenv/config'; npx nest start --watch
```

### 前端 OAuth 登录不工作

OAuth 回调 URL 指向 `:3001`（`BETTER_AUTH_URL`）。社交登录只在访问 **3001 端口**（生产构建）时有效，Vite 的 `:3000` 开发服务器不支持。

### PostgreSQL 连接被拒绝

确认 Docker 容器正在运行：

```bash
docker ps | grep hycoreai-postgres
```

如果容器未启动：

```bash
cd packages/browseros-agent/apps/admin-server
docker compose up -d postgres
```

### 端口 3001 被占用

修改 `packages/backend/.env` 中的 `PORT`，同时更新 `BETTER_AUTH_URL` 和前端的 Vite 代理配置。
