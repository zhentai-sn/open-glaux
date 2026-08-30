#!/usr/bin/env bash
printf "backend       "; curl -s -m 6 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8000/health
printf "agent-runtime "; curl -s -m 6 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8010/agent-api/v1/health
printf "frontend      "; curl -s -m 6 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5173/
echo
curl -s -m 8 "http://127.0.0.1:8000/images?modality=carotid_imt" -o /tmp/imgs.json
python3 -c "
import json
d=json.load(open('/tmp/imgs.json'))
print(f'图像列表 {len(d)} 张,侧栏前 4:', [x['id'] for x in d[:4]])
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
