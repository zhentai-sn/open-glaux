#!/usr/bin/env bash
# agent-runtime + SDD 02 分割门控（不设这两个变量,segment_region 不会注册）
cd ~/code/pre-tech/open-glaux/agent-runtime
eval "$(grep -m1 '^[[:space:]]*export[[:space:]]\+GITEE_AI_TOKEN=' ~/.bashrc)"
export GLAUX_SEG_API_TOKEN="${GITEE_AI_TOKEN:-}"
export GLAUX_ANNOT_ALLOW_EGRESS=1
echo "segment_region 门控: token 长度 ${#GLAUX_SEG_API_TOKEN}, 外发=1"
exec npm run dev
