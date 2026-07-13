"""Glaux IDE 后端入口——FastAPI 薄壳 + CORS + 契约路由。

    uvicorn app.main:app --reload --port 8000

设计不变量（继承内核）：测量确定性 · 意图守卫（三态显式） · 标定硬拒绝。
后端只做编排/IO/进程隔离的 HTTP 外壳，业务在 science-core / orchestration。
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__, datasource_registry
from .routers.api import router

# 数据源注册表装配（开发者模式 seed 内置源；产品模式空源起步）——见 datasource_registry。
datasource_registry.init()

app = FastAPI(
    title="Glaux IDE Backend",
    version=__version__,
    description="Agentic 颈动脉 IMT 标注器的 FastAPI 外壳（薄）。",
)

# 开发期允许 Vite dev server（5173）跨域；生产由同源/反代收敛。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"ok": True, "version": __version__, "tf_in_process": False}
