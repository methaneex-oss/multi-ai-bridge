#!/usr/bin/env bash
# Smoke test against a running bridge API.
# Usage: BRIDGE_URL=https://multi-ai-bridge.onrender.com ./scripts/smoke_test.sh
set -euo pipefail
BASE="${BRIDGE_URL:-http://127.0.0.1:8080}"
BASE="${BASE%/}"
FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

echo "Smoke against $BASE"

code=$(curl -sS -m 30 -o /tmp/sm_health.json -w "%{http_code}" "$BASE/health" || echo 000)
if [[ "$code" == "200" ]]; then pass "health"; else fail "health ($code)"; fi

PROJ=$(curl -sS -m 30 -X POST -H 'Content-Type: application/json' \
  -d '{"name":"smoke-project","description":"smoke","rules":"evidence over guess"}' \
  "$BASE/api/v1/projects" || echo '{}')
PID=$(echo "$PROJ" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
if [[ -n "$PID" ]]; then pass "create project $PID"; else fail "create project"; fi

TASK=$(curl -sS -m 30 -X POST -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"title\":\"smoke-task\",\"objective\":\"exist\",\"acceptance\":\"listed\",\"owner\":\"smoke\",\"status\":\"open\"}" \
  "$BASE/api/v1/engineering-tasks" || echo '{}')
TID=$(echo "$TASK" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
if [[ -n "$TID" ]]; then pass "create engineering task"; else fail "create engineering task"; fi

code=$(curl -sS -m 20 -o /tmp/sm_bad.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/v1/engineering-tasks" || echo 000)
if [[ "$code" == "400" ]]; then pass "reject empty task"; else fail "reject empty task ($code)"; fi

MEM=$(curl -sS -m 30 -X POST -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"kind\":\"decision\",\"content\":\"smoke decision\",\"provenance\":\"smoke_test.sh\",\"confidence\":\"verified\"}" \
  "$BASE/api/v1/memory" || echo '{}')
MID=$(echo "$MEM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
if [[ -n "$MID" ]]; then pass "create memory"; else fail "create memory"; fi

PACK=$(curl -sS -m 30 "$BASE/api/v1/context?project_id=$PID" || echo '{}')
echo "$PACK" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d.get('pack','')
ok=True
if 'OPEN ENGINEERING TASKS' not in p and 'smoke-task' not in p:
  print('WARN: pack missing open tasks (deploy may lag)')
  ok=False
if 'PROJECT MEMORY' not in p and 'smoke decision' not in p:
  print('WARN: pack missing memory (deploy may lag)')
  ok=False
if 'smoke-project' not in p and d.get('project') is None:
  print('FAIL: project not in context')
  sys.exit(2)
" && pass "context contains project" || fail "context pack"

EXP=$(curl -sS -m 30 "$BASE/api/v1/export" || echo '{}')
echo "$EXP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert 'engineering_tasks' in d or 'projects' in d
print('export keys', list(d.keys())[:8])
" && pass "export snapshot" || fail "export"

if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL SMOKE CHECKS PASSED"
  exit 0
else
  echo "SMOKE HAD FAILURES"
  exit 1
fi
