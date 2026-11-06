#!/usr/bin/env bash
# Regenerates the docs screenshots: fresh demo stack -> seed -> screenshots -> framed PNGs + slideshow.
#   screenshots/run.sh          everything
#   screenshots/run.sh seed     fresh demo stack with demo data only (then browse http://localhost:8180)
#   screenshots/run.sh shoot    screenshots and slideshow only (demo stack already seeded and running)
#   screenshots/run.sh down     remove the demo stack and its data
set -euo pipefail
cd "$(dirname "$0")/.."
# Demo only: the demo database holds no real credentials
export DBT_UI__SCHEDULER_ENCRYPTION_KEY=ZGVtby1rZXktZm9yLXNjcmVlbnNob3RzLW9ubHktMDA=
compose() { docker compose -f docker-compose.yml -f screenshots/docker-compose.demo.yml "$@"; }
MODE=${1:-all}

if [ "$MODE" = down ]; then compose down -v; rm -rf screenshots/.demo; exit; fi

if [ "$MODE" = all ] || [ "$MODE" = seed ]; then
  compose down -v 2>/dev/null || true
  rm -rf screenshots/.demo
  screenshots/prepare-demo-repos.sh
  compose up -d --build
  until curl -sf http://localhost:8180/api/scheduler/status | grep -q '"ready":true'; do sleep 2; done
fi

cd screenshots
[ -d node_modules ] || { npm ci; npx playwright install chromium; }
if [ "$MODE" = all ] || [ "$MODE" = seed ]; then npx tsx seed.ts; fi
if [ "$MODE" = all ] || [ "$MODE" = shoot ]; then
  npx tsx shoot.ts
  npx tsx slideshow.ts
fi
