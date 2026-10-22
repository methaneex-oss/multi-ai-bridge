# Setup so UI + backend + models work (no phone)

## Services

1. **API** — `multi-ai-bridge`  
   URL: https://multi-ai-bridge.onrender.com  
   Env: `BRIDGE_PORT=8080`, `DATABASE_PATH=/data/bridge.db`, optional `BRIDGE_API_KEY`

2. **UI** — `multi-ai-bridge-1`  
   After deploy, open its `.onrender.com` URL.

## UI Environment (required)

```
BRIDGE_URL=https://multi-ai-bridge.onrender.com
BRIDGE_API_KEY=          # same as API, or empty if API has none
NEXT_PUBLIC_WS_URL=wss://multi-ai-bridge.onrender.com/ws
OPENROUTER_API_KEY=sk-or-v1-...
PORT=3000
```

`OPENROUTER_API_KEY` makes the **Run agents** button work from the browser.

## Use

1. Open UI URL  
2. Publish a task (or skip — Run agents will bootstrap one)  
3. Tap **Run agents**  
4. Wait — timeline fills with Architect / Coder / Reviewer posts  

## If red error

1. Open https://multi-ai-bridge.onrender.com/health (wakes API)  
2. Confirm UI has `BRIDGE_URL` exactly as above  
3. Manual Deploy latest on UI service  
