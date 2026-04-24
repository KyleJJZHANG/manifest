# HyCore 自部署 Manifest 升级文档

> 适用场景：你已经在服务器 `iZt4ndy9zj9ipgzddxq66cZ` 用 `/opt/manifest/docker-compose.yml` 运行着 `manifestdotbuild/manifest:latest`，现在需要把 body size 限制（或任何其他修改）打进去，**同时保留所有租户、agent、API key、消息历史数据**。

---

## 背景：为什么要改

- 服务器上 `manifestdotbuild/manifest:latest` 的 `express.json()` body limit 太小（经测试 300KB 可以，2.5MB 不可以，推测老版本是 `'1mb'`），导致 BrowserOS agent 带截图的请求被 `PayloadTooLargeError` → Nest 兜底 404
- 本仓库 `packages/backend/src/main.ts:89-90` 已经把 limit 改到 `'5mb'`，只需要 build 成镜像替换即可

---

## 这次升级动什么，不动什么

| 组件 | 是否变动 | 说明 |
|---|---|---|
| `manifest` 容器 | **重建** | 用新镜像启动 |
| `postgres` 容器 | 不动 | 用 `--no-deps` 跳过 |
| `pgdata` 命名卷（数据库实际存储） | **完全不动** | 所有用户、agent、key、message 全保留 |
| `/opt/manifest/docker-compose.yml` | 改一行 `image:` | 其余保持 |
| `.env` | 不动 | BETTER_AUTH_SECRET 等敏感配置保留 |
| nginx 配置 / SSL 证书 | 不动 | |

---

## 前置要求

- **本机**：Windows + Docker Desktop（或任意装了 docker 的机器）
- **本机**：能 ssh 到服务器
- **本机**：本仓库完整 clone 在 `D:\Dev\HyCore\DigitalTwin\AutoAmazon\BrowserOS\ModelMgm\manifest`
- **服务器**：docker + docker compose v2 在跑（已验证）

---

## 步骤 1 —— 本地 build 镜像

打开 PowerShell 或 Git Bash：

```powershell
cd D:\Dev\HyCore\DigitalTwin\AutoAmazon\BrowserOS\ModelMgm\manifest

# 构建（build context = manifest 仓库根，Dockerfile 在 docker/ 下）
docker build -f docker/Dockerfile -t manifest-hycore:5mb .
```

首次 build 会比较慢（下载基础镜像 + 装 node_modules + 构建前后端），大概 5-15 分钟。成功后验证：

```powershell
docker images manifest-hycore
# REPOSITORY          TAG    IMAGE ID       CREATED        SIZE
# manifest-hycore     5mb    xxxxxx         10 seconds     ~500MB-1GB
```

---

## 步骤 2 —— 把镜像搬到服务器

镜像有 500MB-1GB，两种方式任选其一。

### 方式 A：save / load tarball（推荐，不需要 registry）

**本机**导出：

```powershell
# PowerShell / cmd / bash 都可以
docker save -o manifest-hycore-5mb.tar manifest-hycore:5mb
```

导出的 tar 文件在当前目录（几百 MB 到 1GB）。想省带宽可以再 gzip：

```powershell
# 需要 7-Zip 或在 WSL / Git Bash 里：
gzip manifest-hycore-5mb.tar
# 生成 manifest-hycore-5mb.tar.gz（大约能压到原来的 40%）
```

**上传到服务器**：

```powershell
# 未压缩
scp manifest-hycore-5mb.tar root@iZt4ndy9zj9ipgzddxq66cZ:/tmp/
# 或压缩版
scp manifest-hycore-5mb.tar.gz root@iZt4ndy9zj9ipgzddxq66cZ:/tmp/
```

**服务器上** load：

```bash
ssh root@iZt4ndy9zj9ipgzddxq66cZ

# 如果是 .tar
docker load -i /tmp/manifest-hycore-5mb.tar

# 如果是 .tar.gz
gunzip -c /tmp/manifest-hycore-5mb.tar.gz | docker load

# 验证
docker images | grep manifest-hycore
# manifest-hycore     5mb    xxxxxx   ...

# 清理 tarball
rm /tmp/manifest-hycore-5mb.tar*
```

### 方式 B：推到 Docker Hub（如果你有账号）

**本机**：

```powershell
docker tag manifest-hycore:5mb YOUR_DOCKERHUB_USER/manifest-hycore:5mb
docker login
docker push YOUR_DOCKERHUB_USER/manifest-hycore:5mb
```

**服务器**：

```bash
docker pull YOUR_DOCKERHUB_USER/manifest-hycore:5mb
```

这种方式以后升级更方便，本地 push → 服务器 pull 即可。但注意 Docker Hub 公开镜像会被任何人拉取，私有仓库需要付费或自建。

---

## 步骤 3 —— 服务器上切换镜像

```bash
cd /opt/manifest

# 1. 备份现有 compose（出事可以秒回滚）
cp docker-compose.yml docker-compose.yml.bak.$(date +%Y%m%d-%H%M)

# 2. 改 image 这一行
#    原: image: manifestdotbuild/manifest:latest
#    新: image: manifest-hycore:5mb       （方式 A）
#    或: image: YOUR_DOCKERHUB_USER/manifest-hycore:5mb  （方式 B）
sed -i 's|image: manifestdotbuild/manifest:latest|image: manifest-hycore:5mb|' docker-compose.yml

# 3. 确认改对了
grep -n 'image:' docker-compose.yml
# 应该看到新镜像名
```

> 不喜欢 `sed` 就直接 `vim docker-compose.yml` 找 `image: manifestdotbuild/manifest:latest` 改掉。

---

## 步骤 4 —— 只重建 manifest 服务，postgres 完全不动

```bash
cd /opt/manifest
docker compose up -d --no-deps manifest
```

关键参数解读：

- `--no-deps`：**不要**因为 manifest depends_on postgres 就顺便重启 postgres。postgres 容器不动，pgdata 卷完全不受影响
- `up -d`：只重建 image 变了的服务（即 manifest）

执行后立刻看日志：

```bash
docker compose logs -f manifest
```

预期启动 5-10 秒内能看到：

```
[NestFactory] Starting Nest application...
[RouterExplorer] Mapped {/api/v1/health, GET} route
[RouterExplorer] Mapped {/v1/chat/completions, POST} route   ← 关键
Server running on http://127.0.0.1:3001
```

**任何 ERROR 都说明升级失败**，立刻跳到下面"回滚"章节。

---

## 步骤 5 —— 验证

### 5.1 容器状态

```bash
docker compose ps
```

应该看到两个容器都 `Up (healthy)`，且 manifest 那行的 IMAGE 列是你的新镜像 ID。

### 5.2 数据还在

```bash
# 检查数据库里的租户 / agent / key 数量（应该和升级前一致）
docker exec -it $(docker compose ps -q postgres) psql -U manifest -d manifest -c "
SELECT (SELECT COUNT(*) FROM tenants) AS tenants,
       (SELECT COUNT(*) FROM agents) AS agents,
       (SELECT COUNT(*) FROM agent_api_keys) AS api_keys,
       (SELECT COUNT(*) FROM agent_messages) AS messages;
"
```

### 5.3 新的 body limit 起作用了

```bash
python3 -c "import json; print(json.dumps({'model':'auto','messages':[{'role':'user','content':'x'*2500000}]}))" > /tmp/big.json

curl -i -X POST http://127.0.0.1:3001/v1/chat/completions \
    -H "Authorization: Bearer mnfst_g9UtoQUykU9yLnz55JaVwQdw-X-tK9r5SOHU28UZKK8" \
    -H "Content-Type: application/json" \
    --data-binary @/tmp/big.json | head -n 3
```

**升级前**：`HTTP/1.1 404 Not Found` + `{"message":"Cannot POST /v1/chat/completions",...}`
**升级后**：`HTTP/1.1 200 OK`（会真的路由到 Claude/MiniMax 并返回回答）

### 5.4 浏览器访问 dashboard

打开 `https://manifest.andone.dsbdns.hycoretech.cn`，用原账号登录 —— 所有 agent、用量曲线、历史消息都应该还在。

---

## 回滚

如果任何一步出错：

```bash
cd /opt/manifest

# 1. 恢复旧 compose
cp docker-compose.yml.bak.YYYYMMDD-HHMM docker-compose.yml

# 2. 只重建 manifest（postgres 依旧不动）
docker compose up -d --no-deps manifest

# 3. 验证回到老版本
docker compose ps
docker compose logs --tail=20 manifest
```

数据不受任何影响，回滚是秒级的。

---

## 数据安全注意事项（务必读）

`pgdata` 是 docker **命名卷**（named volume），实际存储在 docker 自己管理的目录（通常是 `/var/lib/docker/volumes/manifest_pgdata/_data`）。

**以下命令绝对不要执行，任何一条都会抹掉数据库**：

```bash
docker compose down -v                 # -v 会删除 volume
docker volume rm manifest_pgdata       # 直接删卷
docker volume prune                    # 清理"未使用"的 volume，如果 postgres 恰好停着就会被带走
docker system prune -a --volumes       # 同上
```

**安全的清理命令**：

```bash
docker compose down                    # 只停容器，不动 volume
docker compose up -d                   # 重新起来，数据还在
docker image prune                     # 只清理孤儿 image，volume 不动
```

### 备份数据库（建议升级前执行一次）

```bash
# dump 成 SQL 文件
docker exec $(docker compose ps -q postgres) \
    pg_dump -U manifest manifest > /opt/manifest/backup-$(date +%Y%m%d-%H%M).sql

# 或打包整个 pgdata 卷
docker run --rm -v manifest_pgdata:/data -v /opt/manifest:/backup alpine \
    tar czf /backup/pgdata-$(date +%Y%m%d-%H%M).tgz -C /data .
```

恢复（只在不得已时）：

```bash
# 从 SQL 恢复
cat /opt/manifest/backup-YYYYMMDD-HHMM.sql | \
    docker exec -i $(docker compose ps -q postgres) psql -U manifest manifest

# 从 tgz 恢复（需要先 down 服务）
docker compose down
docker run --rm -v manifest_pgdata:/data -v /opt/manifest:/backup alpine \
    sh -c "cd /data && rm -rf * && tar xzf /backup/pgdata-YYYYMMDD-HHMM.tgz"
docker compose up -d
```

---

## 常见故障排查

### build 阶段报 "npm ci" / "npm install" 失败

通常是网络慢或源问题。可以在 Dockerfile 构建阶段设置 npm registry：

```dockerfile
# 在 ModelMgm/manifest/docker/Dockerfile 的 builder 阶段加：
RUN npm config set registry https://registry.npmmirror.com
```

或本机 build 时加 `--build-arg NPM_REGISTRY=https://registry.npmmirror.com`（如果 Dockerfile 已经支持这个 arg）。

### docker load 报 "permission denied"

确认 tar 文件权限和 docker 服务用户：

```bash
sudo chmod 644 /tmp/manifest-hycore-5mb.tar
sudo docker load -i /tmp/manifest-hycore-5mb.tar
```

### 启动后 health check 失败

```bash
docker compose logs manifest | tail -50
# 典型问题：DATABASE_URL 连不上、BETTER_AUTH_SECRET 缺失等
# 但这些配置来自 .env，你没动应该不会变
```

### 确认改到了什么版本

```bash
docker inspect $(docker compose ps -q manifest) --format='{{.Config.Image}}  {{.Created}}'
# Image 应该是 manifest-hycore:5mb，Created 是刚才的时间
```

---

## 以后持续升级

流程固化下来：

1. 改本仓库 `packages/backend/src/main.ts` 或其他源码
2. 本地 `docker build -f docker/Dockerfile -t manifest-hycore:<new-tag> .`
3. `docker save` → `scp` → `docker load`（或用 registry）
4. 服务器改 compose 的 `image:` tag
5. `docker compose up -d --no-deps manifest`

建议每次用不同 tag（比如 `manifest-hycore:20260422`、`manifest-hycore:body50mb`），方便回滚和追溯。
