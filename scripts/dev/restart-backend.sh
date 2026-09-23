#!/usr/bin/env bash
# 只重启 backend。按 PID 精确杀,不碰其他服务。
# 经 /datasources 增删数据源会使缓存与对象索引失效(SDD 10 §11.2);绕过它直接往数据目录拷文件时,
# 带 lru_cache 的列表(如颈动脉)仍要重启才扫得到。
pid=$(pgrep -f "uvicorn app.main" | head -1)
if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; echo "已停旧 backend (pid $pid)"; sleep 3; fi
cd ~/code/pre-tech/open-glaux/backend
# SDD 08 D-4：开发环境显式开发者模式（内置示例源可见），与 run-backend.sh 一致。
export GLAUX_DEV_MODE=${GLAUX_DEV_MODE:-1}
setsid nohup uv run uvicorn app.main:app --port 8000 > ~/code/pre-tech/open-glaux/.dev-logs/backend.log 2>&1 &
echo "backend 重启中..."
sleep 10
curl -s -m 6 -o /dev/null -w "backend HTTP %{http_code}\n" http://127.0.0.1:8000/health
# 健康判据只依赖 /datasources 与 /capabilities（SDD 10 §15.1 F）：无数据机器上 /images 本就为空，
# 不代表服务不可用。
curl -s -m 8 "http://127.0.0.1:8000/datasources" -o /tmp/glaux-datasources.json
curl -s -m 8 -o /dev/null -w "capabilities HTTP %{http_code}\n" "http://127.0.0.1:8000/capabilities"
python3 -c "
import json
d=json.load(open('/tmp/glaux-datasources.json'))
act=[s['id'] for s in d if s['status']=='active']
print(f'数据源 {len(d)} 个,active {len(act)} 个:', act)
"
