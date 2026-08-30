#!/usr/bin/env bash
# 只重启 backend(list_ids 有 lru_cache,新图要重启才扫得到)。按 PID 精确杀,不碰其他服务。
pid=$(pgrep -f "uvicorn app.main" | head -1)
if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; echo "已停旧 backend (pid $pid)"; sleep 3; fi
cd ~/code/pre-tech/open-glaux/backend
setsid nohup uv run uvicorn app.main:app --port 8000 > ~/code/pre-tech/open-glaux/.dev-logs/backend.log 2>&1 &
echo "backend 重启中..."
sleep 10
curl -s -m 6 -o /dev/null -w "backend HTTP %{http_code}\n" http://127.0.0.1:8000/health
curl -s -m 8 "http://127.0.0.1:8000/images?modality=carotid_imt" -o /tmp/imgs.json
python3 -c "
import json
d=json.load(open('/tmp/imgs.json'))
print(f'图像 {len(d)} 张,侧栏前 4:', [x['id'] for x in d[:4]])
"
