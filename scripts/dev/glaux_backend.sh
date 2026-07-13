#!/usr/bin/env bash
cd /home/zhentai/code/pre-tech/open-glaux/backend
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
