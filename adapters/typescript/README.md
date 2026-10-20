# TypeScript Adapter

Client for TypeScript / JavaScript agents.

```ts
import { BridgeClient } from "./client";

const client = new BridgeClient({ baseUrl: "http://localhost:8080" });
const state = await client.getState();
await client.contribute({
  agentName: "Claude",
  role: "Architect",
  contributionType: "plan",
  content: "..."
});
```
