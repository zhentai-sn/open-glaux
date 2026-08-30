#!/usr/bin/env bash
# backend + 放宽演示区间上限,让联调用的 tech_901(自然图)出现在图像列表里。
# 真实数据是 tech_001..500,放宽到 999 不影响它们。
cd ~/code/pre-tech/open-glaux/backend
export GLAUX_DEMO_HI=999
# SDD 08 D-4：生产缺省已翻为产品模式（无内置源）。开发环境显式打开，行为与改前一致。
export GLAUX_DEV_MODE=${GLAUX_DEV_MODE:-1}
echo "演示区间: ${GLAUX_DEMO_LO:-401}..${GLAUX_DEMO_HI}"
exec uv run uvicorn app.main:app --port 8000
