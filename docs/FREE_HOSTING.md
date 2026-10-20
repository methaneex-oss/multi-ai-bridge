# Free / public hosting notes

The bridge can run on free tiers for testing. Treat public URLs as **not private**.

## Create `.env` (required)

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```env
OPENROUTER_API_KEY=your-key
BRIDGE_API_KEY=some-long-random-secret
```

`.env` is gitignored on purpose. It will never appear in the GitHub repo.

## Railway / Render / Fly (Docker)

1. Connect the GitHub repo `methaneex-oss/multi-ai-bridge`
2. Use `docker-compose.yml` or deploy the `bridge` service first
3. Set environment variables in the host dashboard (same names as `.env`)
4. Expose port 8080 (API) and 3000 (UI) if available

Free tiers often sleep when idle. First request after sleep can take 30–60s.

## Security on a public URL

- Always set `BRIDGE_API_KEY`
- Do not commit real keys
- Model usage (OpenRouter etc.) still costs money when agents run
- Obscure URLs are not real security; use the API key
