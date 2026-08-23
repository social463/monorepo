#!/bin/bash
set -eu

cd /app

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  pnpm --filter @legends/api exec prisma migrate deploy
fi

node apps/api/dist/server.js &
API_PID=$!

shutdown() {
  kill "$API_PID" >/dev/null 2>&1 || true
  wait "$API_PID" >/dev/null 2>&1 || true
}

trap shutdown INT TERM

nginx -g "daemon off;" &
NGINX_PID=$!

wait -n "$API_PID" "$NGINX_PID"
STATUS=$?

shutdown
kill "$NGINX_PID" >/dev/null 2>&1 || true
wait "$NGINX_PID" >/dev/null 2>&1 || true

exit "$STATUS"
