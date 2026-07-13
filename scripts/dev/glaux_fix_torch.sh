#!/usr/bin/env bash
set -e
export PATH="$HOME/.local/bin:$PATH"
TSVENV="$HOME/glaux_models/totalseg/.venv-ts"
export VIRTUAL_ENV="$TSVENV"
echo "=== current versions ==="
"$TSVENV/bin/python" -c "import torch; print('torch', torch.__version__)" 2>/dev/null || echo "torch import broken"
"$TSVENV/bin/python" -m pip show torchvision 2>/dev/null | grep -i version || echo "no tv"
echo "=== reinstall matched pair together ==="
uv pip install --python "$TSVENV/bin/python" --reinstall "torch==2.5.1" "torchvision==0.20.1" --index-url https://download.pytorch.org/whl/cpu 2>&1 | tail -10
echo "=== verify ==="
"$TSVENV/bin/python" -c "import torch,torchvision; from torchvision.ops import nms; print('torch',torch.__version__,'tv',torchvision.__version__,'nms OK')"
