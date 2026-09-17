#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
docker compose stop
echo "Glaux stopped. Conversation data is retained."
