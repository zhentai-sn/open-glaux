#!/usr/bin/env bash
cd /home/zhentai/code/pre-tech/open-glaux/backend
# SDD 08 D-4：开发环境显式开发者模式（内置示例源可见）。
export GLAUX_DEV_MODE=${GLAUX_DEV_MODE:-1}
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
