#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
trap 'echo "Startup failed. Check Docker, network access and port availability. Run: docker compose logs --tail=100" >&2' ERR
command -v docker >/dev/null || { echo "Install Docker with Compose first: https://docs.docker.com/get-docker/" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Start Docker, then run this script again." >&2; exit 1; }
docker compose version >/dev/null
if [[ -f images.tar ]]; then docker load -i images.tar; fi
docker compose up -d --wait --wait-timeout 120 --pull missing
# Read the resolved mapping so .env and environment overrides open the correct URL.
address=$(docker compose port web 8080)
url="http://${address}"
echo "Glaux is ready: $url"
echo "Closing the browser does not stop Glaux. Run ./stop.sh to stop it; history is retained."
if [[ ${GLAUX_NO_BROWSER:-0} != 1 ]]; then
  if command -v open >/dev/null; then open "$url" || true
  elif command -v xdg-open >/dev/null; then xdg-open "$url" >/dev/null 2>&1 || true
  fi
fi
