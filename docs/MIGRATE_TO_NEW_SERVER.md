# Manifest 跨服务器迁移文档

> 适用场景：你已经在**老服务器**上跑着官方 `manifestdotbuild/manifest:latest`（或之前的自构建版本），有积累的租户、agent、API key、消息历史；现在想在**新服务器**上启动新镜像（比如 `manifest-hycore:5mb`），并把老服务器的所有数据迁移过来，同时**老服务器保持运行**直到验证完成。

> 配套文档：
> - 镜像构建：见 `HYCORE_DEPLOY.md`
> - 本地开发：见 `LOCAL_SETUP.md`

---

## 核心原则

1. **镜像和数据是两件事**：镜像走 `docker save / load`（或 registry），数据走 `pg_dump`
2. **老服务器先别关**：新服务器跑通、流量切完、稳定 ≥7 天再考虑下线，DNS TTL 内可秒回滚
3. **一切操作前先备份**：双备份（SQL dump + pgdata 卷 tar），二选一损坏还能用另一份
4. **`pg_dump` 是在线操作**：不需要停服、不影响老服务器，PostgreSQL MVCC 保证一致性快照

---

## 整体流程

```
[老服务器]                                    [新服务器]
旧 manifest + postgres:16 + pgdata
         │
         ① 备份（SQL + pgdata.tgz）           ① 装 docker、建 /opt/manifest
         │                                    ② 加载新镜像
         ② scp dump  ─────────────────────────▶ ③ 拷 .env / compose、改 image:
                                              ④ 只起 postgres，等 healthy
                                              ⑤ psql 灌库，抽查记录数
                                              ⑥ 起 manifest，看日志
                                              ⑦ 端到端验证（API + 浏览器）
         ③ 验证通过后 → DNS / nginx 切流量
         ④ 老服务器至少保留 7 天再下线
```

---

## 前置要求

- **老服务器**：可 ssh、`docker compose` 在跑、有 `/opt/manifest/.env` 和 `docker-compose.yml`
- **新服务器**：可 ssh、装好 docker（v20.10+）+ docker compose v2、有足够磁盘（至少 2× 当前 pgdata 大小）
- **本机 / 跳板机**：能 ssh 到两台服务器
- **新镜像**：已经按 `HYCORE_DEPLOY.md` 步骤 1 在本机或某处 build 好（或推到 registry）

---

## 阶段 1 —— 老服务器：备份

**这一步对老服务器零影响**，可以在工作时间执行。

```bash
ssh root@老服务器
cd /opt/manifest
mkdir -p /opt/manifest/migrate
TS=$(date +%Y%m%d-%H%M)

# A. 逻辑备份（主用）—— pg_dump 走 MVCC 快照，无锁
docker exec $(docker compose ps -q postgres) \
    pg_dump -U manifest -d manifest \
            --no-owner --no-privileges --clean --if-exists \
    > /opt/manifest/migrate/manifest-${TS}.sql

# B. 物理备份（保险用，万一 SQL 出问题）
docker run --rm \
    -v manifest_pgdata:/data \
    -v /opt/manifest/migrate:/backup \
    alpine tar czf /backup/pgdata-${TS}.tgz -C /data .

# 验证
ls -lh /opt/manifest/migrate/
head -50 /opt/manifest/migrate/manifest-${TS}.sql | tail -20
# 应该看到大量 DROP TABLE / CREATE TABLE / COPY 之类
```

**关键参数说明**：
- `--no-owner --no-privileges`：剥离 owner 和 GRANT 信息，让 dump 更便携（新服务器的用户名/密码可以不同）
- `--clean --if-exists`：导入时先 DROP 再 CREATE，幂等，可以反复重跑

如果 dump 文件大，可以再 gzip 一下：

```bash
gzip /opt/manifest/migrate/manifest-${TS}.sql
# → manifest-YYYYMMDD-HHMM.sql.gz（通常能压到原来 1/5）
```

---

## 阶段 2 —— 新服务器：基础设施（**还没碰数据**）

### 2.1 装 docker、建目录

```bash
ssh root@新服务器
mkdir -p /opt/manifest/migrate
cd /opt/manifest
```

如果还没装 docker：

```bash
# Debian/Ubuntu
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker compose version  # 确认 v2 可用
```

### 2.2 关键 —— 拷 `.env`，逐项审视

```bash
# 从老服务器拷过来
scp root@老服务器:/opt/manifest/.env /opt/manifest/.env
chmod 600 /opt/manifest/.env
```

**必须保留原值**（否则数据会"在但用不了"）：

| 字段 | 不一致的后果 |
|---|---|
| `BETTER_AUTH_SECRET` | 已登录的 session 全失效（用户要重登）。**密码本身仍有效**，因为密码哈希不依赖此 secret。强烈建议保留原值。 |
| `POSTGRES_PASSWORD` 与 `DATABASE_URL` 里的密码 | 两边必须一致，否则应用连不上数据库 |
| `API_KEY` | 用 `X-API-Key` header 调用的客户端会失效（要换 key） |

**应该改的字段**：

| 字段 | 改成什么 |
|---|---|
| `BETTER_AUTH_URL` | 新域名，比如 `https://manifest.new-domain.com` |
| `BIND_ADDRESS` | 看走不走 nginx，通常 `127.0.0.1` |

**OAuth provider 重新配置**（如果用了 Google/GitHub/Discord 登录）：去对应 OAuth 控制台把 **Authorized Redirect URI** 加上新域名（`https://新域名/api/auth/callback/google` 等），否则社交登录 redirect 失败。

### 2.3 拷 `docker-compose.yml`，改镜像名

```bash
scp root@老服务器:/opt/manifest/docker-compose.yml /opt/manifest/

# 改 image: 行
sed -i 's|image: manifestdotbuild/manifest:latest|image: manifest-hycore:5mb|' \
    /opt/manifest/docker-compose.yml

# 验证
grep -n 'image:' /opt/manifest/docker-compose.yml
# 应该看到：image: manifest-hycore:5mb
```

#### 2.3.1 修复 healthcheck（**老 compose 必须改，否则容器永远 unhealthy**）

新镜像 `manifest-hycore:5mb` 基于 **distroless**（`gcr.io/distroless/nodejs22-debian13:nonroot`），里面**没有 shell、没有 wget、没有 curl**，只有 `node` 一个可执行文件。老 compose 的 healthcheck 通常长这样：

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/api/v1/health || exit 1"]
```

`CMD-SHELL` 会让 docker 用 `/bin/sh -c` 包一层，而 distroless 没有 `/bin/sh`。结果就是 healthcheck 永远 exec 失败，应用其实是好的（`/api/v1/health` 返回 200），但 docker 一直标 `unhealthy`。

**先看看你 compose 是不是这种情况**：

```bash
grep -A 1 'healthcheck' /opt/manifest/docker-compose.yml | grep -E 'CMD-SHELL|wget|curl'
# 有任何输出 → 老格式，必须改（继续往下）
# 没输出 → 看下一行 test: 内容；如果是 ["CMD", "node", ...] 就是新格式，跳过此步
```

**修复（推荐：替换为 exec-form 的 node 探针）**：

```bash
cd /opt/manifest

# 备份
cp docker-compose.yml docker-compose.yml.bak.$(date +%Y%m%d-%H%M)

# 用 python 做精确替换，避开 shell 引号地狱
python3 - <<'PY'
old = 'test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/api/v1/health || exit 1"]'
new = 'test: ["CMD", "node", "-e", "fetch(\'http://127.0.0.1:3001/api/v1/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]'
with open('docker-compose.yml') as f:
    s = f.read()
if old in s:
    open('docker-compose.yml','w').write(s.replace(old, new))
    print("OK: replaced")
else:
    print("FAIL: pattern not found, edit manually (search for 'healthcheck' under manifest service)")
PY

# 验证替换后的样子
grep -A 6 'healthcheck:' docker-compose.yml | head -8
```

替换后 healthcheck 行长这样：

```diff
-     test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/api/v1/health || exit 1"]
+     test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
```

**关键变化**：
- `CMD-SHELL` → `CMD`：不走 `/bin/sh -c` 包装，直接 exec
- `wget` → `node -e fetch(...)`：用镜像里现有的 `node` 替代 `wget`（distroless 唯一可执行的就是 `node`）
- 端口写死 `3001`：和你 `.env` 的 `PORT=3001` 对齐，省掉 compose 的 `$${PORT}` 转义

**替代方案（更简单，但灵活性低）**：直接**删掉**整个 `healthcheck:` 块（manifest 服务下的，不是 postgres 的）。删掉后会 fallback 到 Dockerfile 里自带的 healthcheck（`docker/Dockerfile:95-96`），那个本来就是正确的 exec-form node 探针，能直接用。

```bash
# 如果想用这个方案，sed 删 7 行：
sed -i '/^    healthcheck:$/,/^    read_only/{/^    read_only/!d}' docker-compose.yml
# 注意：这条假设 healthcheck 块紧接着 read_only。先 cp 备份再跑。
```

### 2.4 加载新镜像

如果是 tar 文件：

```bash
# 假设已经从本机 scp 上传到 /tmp/
docker load -i /tmp/manifest-hycore-5mb.tar
docker images | grep manifest-hycore
# manifest-hycore   5mb   xxxxxx   ...
```

如果是 registry：

```bash
docker pull YOUR_DOCKERHUB_USER/manifest-hycore:5mb
```

---

## 阶段 3 —— 数据迁移

### 3.1 上传 dump 到新服务器

```bash
# 在老服务器上：
scp /opt/manifest/migrate/manifest-*.sql \
    root@新服务器:/opt/manifest/migrate/

# 如果是 .sql.gz
scp /opt/manifest/migrate/manifest-*.sql.gz \
    root@新服务器:/opt/manifest/migrate/
```

### 3.2 只启动 postgres（**注意 `--no-deps`**）

```bash
ssh root@新服务器
cd /opt/manifest
docker compose up -d --no-deps postgres
docker compose ps
# postgres 应该 Up (healthy)
```

`--no-deps` 阻止 docker 因为 manifest 服务还没起就报错。此时 postgres 容器里有一个**空的** `manifest` 数据库（由 compose 的 `POSTGRES_DB=manifest` 创建），manifest 应用**还没起**，没有任何 schema。

### 3.3 灌入 SQL dump

```bash
# 如果是 .sql
cat /opt/manifest/migrate/manifest-*.sql | \
    docker exec -i $(docker compose ps -q postgres) \
    psql -U manifest -d manifest

# 如果是 .sql.gz
gunzip -c /opt/manifest/migrate/manifest-*.sql.gz | \
    docker exec -i $(docker compose ps -q postgres) \
    psql -U manifest -d manifest
```

期望输出：大量 `CREATE TABLE` / `COPY` / `ALTER TABLE` 之类，结尾**不应该有 ERROR**。

如果出现 `ERROR: relation ... already exists`，说明你之前不小心起过 manifest 服务、它跑过 migrations。两种修复：
- 用 `--clean --if-exists` 重新 dump（首选）
- 或在新服务器手动 drop schema：`docker exec -it $(docker compose ps -q postgres) psql -U manifest -d manifest -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"` 然后再灌

### 3.4 抽查数据完整性

```bash
docker exec -it $(docker compose ps -q postgres) \
    psql -U manifest -d manifest -c "
SELECT (SELECT COUNT(*) FROM tenants)        AS tenants,
       (SELECT COUNT(*) FROM agents)         AS agents,
       (SELECT COUNT(*) FROM agent_api_keys) AS api_keys,
       (SELECT COUNT(*) FROM agent_messages) AS messages,
       (SELECT COUNT(*) FROM \"user\")       AS users;
"
```

数字必须**和老服务器完全一致**。如果对不上，立刻停手排查（多半是 dump 没下完整、或者中间有 ERROR 被吞了）。

老服务器同一查询的对照命令：

```bash
ssh root@老服务器
docker exec -it $(cd /opt/manifest && docker compose ps -q postgres) \
    psql -U manifest -d manifest -c "
SELECT (SELECT COUNT(*) FROM tenants)        AS tenants,
       (SELECT COUNT(*) FROM agents)         AS agents,
       (SELECT COUNT(*) FROM agent_api_keys) AS api_keys,
       (SELECT COUNT(*) FROM agent_messages) AS messages,
       (SELECT COUNT(*) FROM \"user\")       AS users;
"
```

### 3.5 启动 manifest 服务

```bash
cd /opt/manifest
docker compose up -d manifest
docker compose logs -f manifest
```

**关键观察点**：

- `[NestFactory] Starting Nest application...` —— 应用启动
- 如果新镜像和老镜像 schema 完全一致：**不应该看到** `running migration X...` 的日志（migrations 表里所有记录都是已应用状态）
- 如果新镜像有比老镜像更新的 migration：会看到自动按顺序跑新的，这是预期行为
- `[Bootstrap] Server running on http://0.0.0.0:...` —— 启动完成

---

## 阶段 4 —— 验证

### 4.1 健康检查（容器内）

```bash
# 应用层健康（最重要 —— 这个返回 200 才说明真的健康）
curl http://127.0.0.1:${PORT:-2099}/api/v1/health
# {"status":"healthy","uptime_seconds":...}

# 容器层健康（docker 自己跑探针的判断）
docker compose ps
# manifest 那行的 STATUS 列应该是：Up X minutes (healthy)
```

**如果 `curl` 返回 200 但 `docker compose ps` 显示 `(unhealthy)`** —— 应用是好的，**healthcheck 命令本身跑不起来**。最常见原因：跳过了步骤 2.3.1，老 compose 的 `wget`/`CMD-SHELL` 写法在 distroless 镜像里没有依赖。诊断命令：

```bash
docker inspect manifest-manifest-1 --format '{{json .State.Health}}' | head -c 2000
# 看 Output 字段。如果有 'exec: "/bin/sh": ... no such file or directory'
# 或 'wget: not found'，回到步骤 2.3.1 改 healthcheck，然后：
#   docker compose up -d --no-deps --force-recreate manifest
```

### 4.2 用老服务器的 mnfst_ key 测 chat completion

```bash
# 找一个老服务器上有效的 agent key（注意：这个 key 是从老 DB 迁过来的，应该已经在新服务器生效）
curl -X POST http://127.0.0.1:${PORT:-2099}/v1/chat/completions \
  -H 'Authorization: Bearer mnfst_<老服务器上的 key>' \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'

# 应该返回 200 + 真实 LLM 回复
```

### 4.3 浏览器端到端

如果新服务器还没接公网域名，可以临时用 `ssh -L 2099:127.0.0.1:2099 root@新服务器` 端口转发到本机浏览器测：

- 用老账号登录（密码生效，session 因 secret 不同会要求重登一次）
- 仪表盘能看到所有 agent
- Message Log 历史记录在
- 用量曲线（Tokens / Costs）能正常渲染
- Routing 配置（providers / tier assignments）保留

### 4.4 切流量

**只有上面全通过**才动 DNS / nginx upstream：

```
DNS A 记录: manifest.your-domain.com → 老 IP  ▶▶▶  新 IP
（或 nginx upstream 改指向新服务器）
```

**老服务器至少保留 7 天**，DNS TTL 内可以秒回滚到老服务器。

---

## 回滚

任何阶段出问题，立刻回滚：

### 阶段 1-2 出错
新服务器还没碰数据，直接 `docker compose down`，调整后重来。

### 阶段 3 数据灌错
最容易：`docker compose down`（注意**不是** `down -v`！）→ 删掉新服务器的 pgdata 卷 → 重新起 postgres → 重新灌 dump。

```bash
docker compose down
docker volume rm manifest_pgdata   # 注意：只在新服务器执行，老服务器绝对不要执行这条
docker compose up -d --no-deps postgres
# 等 healthy 后重新执行 3.3
```

### 阶段 4 应用跑不起来
日志里看错误。常见原因：
- `BETTER_AUTH_SECRET` 没设 / 长度不够 → 改 .env 重启
- DB 连接失败 → 检查 `DATABASE_URL` 和 `POSTGRES_PASSWORD` 是否一致
- 如果新镜像有 migration 但运行失败 → `migrations_table` 状态可能损坏，从 pgdata.tgz 物理恢复（见下文）

### 阶段 4 切流量后用户报问题
DNS 切回老服务器，老服务器一直在跑数据没动。

---

## 数据安全护栏（**必读**）

### 老服务器上**绝对不要执行**

| 危险命令 | 后果 |
|---|---|
| `docker compose down -v` | `-v` 删除 volume，老数据立刻销毁 |
| `docker volume rm manifest_pgdata` | 直接删卷 |
| `docker volume prune` | 清"未使用"的卷，如果 postgres 当时停着会被带走 |
| `docker system prune -a --volumes` | 同上，连带清干净 |

### 新服务器上的"安全清理"

```bash
docker compose down                # 只停容器，不动 volume
docker compose up -d               # 重新起
docker image prune                 # 只清孤儿 image，volume 不动
```

### 物理恢复（紧急情况下从 pgdata.tgz 恢复）

只在 SQL dump 损坏、新服务器搞砸、老服务器也炸了的极端情况用：

```bash
docker compose down                # 注意没有 -v
docker volume rm manifest_pgdata   # 删空卷
docker volume create manifest_pgdata
docker run --rm -v manifest_pgdata:/data -v /opt/manifest/migrate:/backup alpine \
    sh -c "cd /data && tar xzf /backup/pgdata-YYYYMMDD-HHMM.tgz"
docker compose up -d
```

**前提**：两边 PostgreSQL 主版本必须**完全一致**（compose 都是 `postgres:16-alpine` 所以 OK）。

---

## 备选方案：物理迁移（不推荐，仅供参考）

如果你的数据量超大（>50GB）、能接受短暂停机、且确认两边 PG 版本一致，可以直接搬 pgdata 卷：

```bash
# 老服务器：停服 + 打包卷
ssh root@老服务器
cd /opt/manifest
docker compose stop                # 注意：stop 不是 down，更不是 down -v
docker run --rm -v manifest_pgdata:/data -v /opt/manifest:/backup alpine \
    tar czf /backup/pgdata-full.tgz -C /data .

# scp 到新服务器
scp /opt/manifest/pgdata-full.tgz root@新服务器:/opt/manifest/

# 新服务器：先确保 manifest_pgdata 卷不存在
ssh root@新服务器
cd /opt/manifest
docker compose up --no-start postgres   # 创建容器但不启动
docker run --rm -v manifest_pgdata:/data -v /opt/manifest:/backup alpine \
    sh -c "cd /data && rm -rf * && tar xzf /backup/pgdata-full.tgz"
docker compose up -d
```

**比 SQL dump 脆的地方**：
- 必须停服（影响业务）
- PG 版本必须**完全一致**（连小版本最好都一致）
- 文件系统编码 / 权限差异可能导致启动失败
- 不便携，dump 文件可以 inspect、可以 grep、可以局部修复，tgz 不行

**结论**：除非数据量大到 dump 不现实（>50GB），否则一律用 SQL dump。

---

## 检查清单（迁移前过一遍）

- [ ] 老服务器 SQL dump 已生成，文件大小合理（不是 0 字节）
- [ ] 老服务器 pgdata.tgz 已生成（保险）
- [ ] 新服务器 docker / docker compose 装好
- [ ] 新服务器 `.env` 拷过来，`BETTER_AUTH_SECRET` 与老一致
- [ ] 新服务器 `.env` 的 `BETTER_AUTH_URL` 改成新域名
- [ ] OAuth 控制台 callback URL 加了新域名（如适用）
- [ ] 新服务器 `docker-compose.yml` 的 `image:` 改了
- [ ] 新服务器 `docker-compose.yml` 的 healthcheck 已改成 exec-form node 探针（**不是 `CMD-SHELL` + `wget` 的老格式**，distroless 没 shell 也没 wget）
- [ ] 新镜像已 `docker load` / `docker pull`，`docker images` 能看到
- [ ] postgres 先起、healthy、灌库、记录数对得上
- [ ] manifest 起、日志干净无 ERROR
- [ ] `docker compose ps` 显示 manifest 是 `Up (healthy)` 而不是 `(unhealthy)`
- [ ] `/api/v1/health` 200
- [ ] mnfst_ key 调 `/v1/chat/completions` 200
- [ ] 浏览器登录、能看到 agent / 历史 message / 用量
- [ ] DNS / nginx 切流量
- [ ] 老服务器**保留至少 7 天**

---

## 后续维护

迁移完成后，老服务器留作回滚保险一段时间，确认稳定（建议 ≥7 天）后才能下线。下线时：

```bash
ssh root@老服务器
cd /opt/manifest

# 最后再 dump 一次，存到本地或对象存储
docker exec $(docker compose ps -q postgres) \
    pg_dump -U manifest -d manifest --no-owner --no-privileges --clean --if-exists \
    | gzip > /tmp/final-backup-$(date +%Y%m%d).sql.gz
scp /tmp/final-backup-*.sql.gz root@新服务器:/opt/manifest/migrate/

# 然后才能停服 + 删卷
docker compose down -v
```

或者更保守：把整个 `/opt/manifest/migrate/` 目录归档到对象存储（OSS / S3），保留半年。
