FROM python:3.12-slim
WORKDIR /app
COPY runners/requirements.txt /app/runners/requirements.txt
RUN pip install --no-cache-dir -r /app/runners/requirements.txt
COPY adapters/python /app/adapters/python
COPY agents /app/agents
COPY runners /app/runners
ENV PYTHONPATH=/app:/app/adapters/python
ENV BRIDGE_URL=http://localhost:8080
# Loop agents on the server — no phone required
CMD ["python", "-m", "runners.run_loop", "--interval", "120"]
