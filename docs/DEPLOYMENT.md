# Deployment Guide (Private Server)

## Requirements

- Ubuntu 22.04 / 24.04 (or any Linux with Docker)
- Docker + Docker Compose
- Open ports 3000 (UI) and 8080 (API) only to trusted networks

## Steps

```bash
git clone https://github.com/methaneex-oss/multi-ai-bridge.git
cd multi-ai-bridge
cp .env.example .env
# edit .env if you want an API key
docker compose up -d --build
```

## Verify

```bash
curl http://localhost:8080/health
# open http://localhost:3000 in browser
```

## Making it private

- Firewall the ports
- Put behind Tailscale / WireGuard
- Or put Nginx + basic auth / OAuth in front
- Never expose 8080 publicly without authentication
