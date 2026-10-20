# Python Adapter

Simple client so any Python-based agent (or script calling Claude / Grok / etc.) can talk to the bridge.

```python
from multi_ai_bridge import BridgeClient

client = BridgeClient(base_url="http://localhost:8080", api_key=None)
state = client.get_state()
client.contribute(
    agent_name="Grok",
    role="Coder",
    contribution_type="code",
    content="..."
)
```
