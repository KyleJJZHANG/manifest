# Manifest Deployment Guide (HyCore)

## Architecture

```
Internet → nginx (443) → Manifest container (3001) → PostgreSQL (5432)
```

- **Domain**: `manifest.andone.dsbdns.hycoretech.cn`
- **Server**: Ubuntu with nginx 1.18.0
- **App**: Docker Compose (manifest + postgres)

## Quick Deploy

```bash
# 1. Clone and enter the docker directory
cd ModelMgm/manifest/docker

# 2. Create .env from template
cp .env.example .env
# Edit .env: set BETTER_AUTH_SECRET, POSTGRES_PASSWORD, etc.

# 3. Start the stack
docker compose up -d

# 4. Deploy nginx config
sudo cp nginx-manifest.conf /etc/nginx/sites-available/manifest
sudo ln -sf /etc/nginx/sites-available/manifest /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Nginx Configuration

The nginx config (`nginx-manifest.conf`) includes critical settings for AI agent compatibility:

| Setting | Value | Why |
|---------|-------|-----|
| `client_max_body_size` | `50m` | Chat requests include base64 screenshots, 40+ messages, 30 tool definitions |
| `proxy_read_timeout` | `300s` (600s for chat) | LLM streaming responses can take minutes |
| `proxy_buffering` | `off` | Required for SSE and streaming responses |

### Common Issue: HTTP 413 Request Entity Too Large

If agents get 413 errors when chatting, the nginx `client_max_body_size` is too small.

**Symptoms:**
```
AI_APICallError: Request Entity Too Large
statusCode: 413
responseBody: "<html>...413 Request Entity Too Large...nginx/1.18.0..."
```

**Fix:**
```bash
# Check current nginx config
sudo nginx -T | grep client_max_body_size

# If missing or < 50m, update the server block:
#   client_max_body_size 50m;
sudo nano /etc/nginx/sites-available/manifest
sudo nginx -t && sudo systemctl reload nginx
```

**Root cause:** BrowserOS agent conversations accumulate base64 screenshots (JPEG quality 60, ~100-300KB each) and tool definitions. A conversation with 40+ messages, 30 tools, and several screenshots can easily exceed 5-10MB.

## SSL Certificates

Using Let's Encrypt:
```bash
sudo certbot --nginx -d manifest.andone.dsbdns.hycoretech.cn
```

Certbot auto-renewal is handled by systemd timer. Verify:
```bash
sudo certbot renew --dry-run
```

## Updating Manifest

```bash
cd ModelMgm/manifest/docker
docker compose pull
docker compose up -d
```

## Logs

```bash
# Manifest app logs
docker compose logs -f manifest

# Nginx access/error logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Check for 413 errors specifically
sudo grep "413" /var/log/nginx/error.log
```

## Health Check

```bash
# Local (on server)
curl http://127.0.0.1:3001/api/v1/health

# Remote (through nginx)
curl https://manifest.andone.dsbdns.hycoretech.cn/api/v1/health
```
