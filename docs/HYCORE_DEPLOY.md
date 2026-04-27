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

### 本机

- Windows + Docker Desktop（或任意装了 docker 的机器）
- 能 ssh 到服务器（推荐用 ssh-key，密码也行）
- 本仓库完整 clone 在 `D:\Dev\HyCore\DigitalTwin\AutoAmazon\BrowserOS\ModelMgm\manifest`

### 服务器

- docker 20.10+ + docker compose v2（已验证：`iZt4ndy9zj9ipgzddxq66cZ` 在跑）
- nginx 装好且在反代（已验证）
- HTTPS 证书有效（Let's Encrypt 自动续期）
- 防火墙 / 阿里云安全组放行：**80**（HTTP 跳转）、**443**（HTTPS）。3001 不要对公网开放，让 nginx 转发
- 域名 DNS A 记录已指向服务器 IP（当前：`manifest.andone.dsbdns.hycoretech.cn`）

### SSH 配置（首次访问服务器才需要）

```bash
# 本机生成 ssh key（已有可跳过）
ssh-keygen -t ed25519 -C "kylez@hycore"

# 把公钥扔到服务器
ssh-copy-id root@iZt4ndy9zj9ipgzddxq66cZ
# 或者手动追加：
#   cat ~/.ssh/id_ed25519.pub | ssh root@iZt4ndy9zj9ipgzddxq66cZ \
#     'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'

# 写 ~/.ssh/config 起别名（可选，但很省事）
cat >> ~/.ssh/config <<'EOF'
Host hycore-manifest
    HostName iZt4ndy9zj9ipgzddxq66cZ
    User root
    IdentityFile ~/.ssh/id_ed25519
EOF

# 之后用 `ssh hycore-manifest` 就能直连
```

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

---

## nginx 配置（首次部署 + 升级现有）

> **场景说明**：
> - **首次部署到全新服务器** → 跑下面 §A 全套（装 nginx + 写配置 + certbot 申请证书）
> - **服务器已有 nginx 在反代 manifest** → 跳到 §B，只补充图片传输需要的 `client_max_body_size` 等配置
> - **升级 5mb 镜像后发现 BrowserOS 截图请求被 nginx 挡了** → 直接看 §B

Manifest 的 `/v1/chat/completions` 代理 LLM 请求时，会**透传完整对话历史**，里面常带 base64 截图。后端 `packages/backend/src/main.ts:95-96` 把 express.json limit 调到了 `5mb`，但**nginx 默认 `client_max_body_size` 只有 1MB**，截图请求会先于应用层被 nginx 用 `413 Request Entity Too Large` 干掉。所以镜像升级和 nginx 升级**必须同时做**才完整。

### §A 首次部署 nginx + HTTPS（全新服务器）

#### A.1 装 nginx + certbot

```bash
ssh root@iZt4ndy9zj9ipgzddxq66cZ
apt update && apt install -y nginx certbot python3-certbot-nginx
```

#### A.2 写 nginx 配置（**含图片传输支持**）

```bash
cat > /etc/nginx/sites-available/manifest <<'EOF'
upstream manifest_app {
    server 127.0.0.1:3001;
    keepalive 16;
}

server {
    listen 80;
    server_name manifest.andone.dsbdns.hycoretech.cn;

    # === 图片 / 截图传输关键配置 ===
    # Manifest 后端 express.json limit = 5MB（含 base64 截图）
    # nginx 这层留 2x headroom，免得合法请求先于应用层被挡
    client_max_body_size 10M;
    client_body_timeout 60s;
    client_body_buffer_size 1M;

    # === LLM 长响应必备 ===
    # Claude/GPT 大请求 + 流式生成可能 60s+，默认 60s 不够
    proxy_connect_timeout 10s;
    proxy_send_timeout    300s;
    proxy_read_timeout    300s;

    # === SSE / 流式响应 ===
    # 后端 /api/v1/events 是 SSE，buffering 一开前端永远收不到增量
    # /v1/chat/completions 流式模式同理
    proxy_buffering off;
    proxy_cache     off;
    proxy_request_buffering off;

    location / {
        proxy_pass http://manifest_app;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
    }
}
EOF
```

> **EOF 必须顶格、单独一行**，否则 heredoc 不结束、终端会卡在 `>` 提示符。

#### A.3 启用 + 测试

```bash
ln -s /etc/nginx/sites-available/manifest /etc/nginx/sites-enabled/
nginx -t                    # 必须看到 "syntax is ok" + "test is successful"
systemctl reload nginx
```

#### A.4 申请 HTTPS（certbot 自动改 nginx 配置）

```bash
certbot --nginx -d manifest.andone.dsbdns.hycoretech.cn
```

按提示输邮箱、同意条款。Certbot 会自动：
- 申请 Let's Encrypt 证书
- 在 nginx 配置里加 SSL block
- 加 HTTP → HTTPS 301 重定向
- 写 cron 自动续期（90 天周期）

> **注意**：certbot 改完后会重写 `/etc/nginx/sites-available/manifest`。`client_max_body_size` 等指令会被保留（certbot 是追加 SSL block 而非全文替换），但**重启后再核对一遍**：
> ```bash
> grep -E 'client_max_body_size|proxy_(read|send)_timeout|proxy_buffering' \
>     /etc/nginx/sites-available/manifest
> ```
> 如果丢了，重新 `cat` 一份覆盖即可。

#### A.5 验证

```bash
# 服务器内
curl -i http://localhost:3001/api/v1/health
curl -i https://manifest.andone.dsbdns.hycoretech.cn/api/v1/health

# 测大请求体不被挡（构造 2.5MB JSON，超过 nginx 默认 1MB 但小于 10MB）
python3 -c "import json; print(json.dumps({'model':'auto','messages':[{'role':'user','content':'x'*2500000}]}))" > /tmp/big.json
curl -i -X POST https://manifest.andone.dsbdns.hycoretech.cn/v1/chat/completions \
    -H "Authorization: Bearer mnfst_<your_key>" \
    -H "Content-Type: application/json" \
    --data-binary @/tmp/big.json | head -3
# 应该看到 200 OK，不能是 413 Request Entity Too Large
```

---

### §B 升级现有 nginx（已有反代，只补图片传输配置）

#### B.1 找到现有配置

```bash
# 通常在以下之一
ls /etc/nginx/sites-available/ /etc/nginx/conf.d/ 2>/dev/null

# 或者直接 grep manifest 域名
grep -rl 'manifest.andone' /etc/nginx/
```

记下文件路径，比如 `/etc/nginx/sites-available/manifest`。

#### B.2 看现状

```bash
grep -E 'client_max_body_size|proxy_(read|send)_timeout|proxy_buffering' \
    /etc/nginx/sites-available/manifest

# 没输出 → 用的全是 nginx 默认（1MB body / 60s timeout / buffering on）→ 必须加
# 有 client_max_body_size 1m 之类小值 → 必须改
# 有 client_max_body_size 10M 且 proxy_*_timeout 300s → 已经 OK，跳过
```

#### B.3 备份 + 改

```bash
cp /etc/nginx/sites-available/manifest \
   /etc/nginx/sites-available/manifest.bak.$(date +%Y%m%d-%H%M)

# 在 manifest 域名的 server { ... } 块内插入下面这段（位置：listen 之后、location 之前）
```

要插入的内容（如果原配置里没有的话）：

```nginx
    client_max_body_size 10M;
    client_body_timeout 60s;
    proxy_connect_timeout 10s;
    proxy_send_timeout    300s;
    proxy_read_timeout    300s;
    proxy_buffering off;
    proxy_cache     off;
    proxy_request_buffering off;
```

如果你的原 location 块里只有 `proxy_pass` 没有 `proxy_http_version` / `Connection ""`，建议补上：

```nginx
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
    }
```

`Connection ""` + `proxy_http_version 1.1` 是 SSE 必须，否则 nginx 会主动关连接。

#### B.4 reload

```bash
nginx -t                  # 改完先 dry-run
systemctl reload nginx    # reload 不断连接，比 restart 安全
```

`reload` 不会中断已有连接，比 `restart` 安全。如果 `nginx -t` 报错，**不要 reload**，先回滚到 `.bak` 文件再排查。

#### B.5 验证（同 A.5）

最关键：

```bash
# 用 BrowserOS 真实截图请求或构造 2-5MB JSON 测
curl -i -X POST https://manifest.andone.dsbdns.hycoretech.cn/v1/chat/completions \
    -H "Authorization: Bearer mnfst_..." -H "Content-Type: application/json" \
    --data-binary @/tmp/big.json | head -3
# 升级前: HTTP/1.1 413 Request Entity Too Large
# 升级后: HTTP/1.1 200 OK
```

---

### nginx 配置常见错误一览

| 现象 | 多半是 | 怎么修 |
|---|---|---|
| `413 Request Entity Too Large` | `client_max_body_size` 太小 | 加大到 10M |
| `504 Gateway Timeout`（大请求 / LLM 长响应） | `proxy_read_timeout` 太短 | 加大到 300s |
| 前端 SSE / streaming 收不到增量，等到全部完成才出现 | `proxy_buffering on`（默认）| 加 `proxy_buffering off` |
| nginx 启动不了，certbot 续期失败 | sites-enabled 里有半成品配置 | `nginx -t` 看具体哪行错，删掉或修好 |
| `502 Bad Gateway` | manifest 容器 down 了，或 PORT 不对 | `docker compose ps` + 检查 nginx upstream 端口 |
