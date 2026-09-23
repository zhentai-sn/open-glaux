#!/usr/bin/env bash
printf "backend       "; curl -s -m 6 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8000/health
printf "agent-runtime "; curl -s -m 6 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8010/agent-api/v1/health
printf "frontend      "; curl -s -m 6 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5173/
echo
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
echo
echo "--- agent-runtime 的分割门控环境变量 ---"
pid=$(pgrep -f "tsx watch src/index.ts" | tail -1)
if [ -n "$pid" ]; then
  for v in GLAUX_ANNOT_ALLOW_EGRESS GLAUX_SEG_API_TOKEN; do
    val=$(tr '\0' '\n' < /proc/$pid/environ | grep "^$v=" | cut -d= -f2-)
    if [ "$v" = "GLAUX_SEG_API_TOKEN" ]; then
      [ -n "$val" ] && echo "  $v = (已设置,长度 ${#val})" || echo "  $v = **未设置**"
    else
      echo "  $v = ${val:-**未设置**}"
    fi
  done
else
  echo "  (找不到进程)"
fi
