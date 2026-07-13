#!/usr/bin/env bash
set -e
export PATH="$HOME/.local/bin:$PATH"
TSVENV="$HOME/glaux_models/totalseg/.venv-ts"
export VIRTUAL_ENV="$TSVENV"
uv pip install --python "$TSVENV/bin/python" torchvision --index-url https://download.pytorch.org/whl/cpu 2>&1 | tail -8
echo "=== verify ==="
"$TSVENV/bin/python" -c "import torch,torchvision; from torchvision.ops import nms; print('torch',torch.__version__,'tv',torchvision.__version__,'nms OK')"
