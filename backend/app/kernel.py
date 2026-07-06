"""确定性内核的薄封装（F8/F9）——真实 orchestrator 意图 + pdm 测量 + 模型注册表。

后端不搬业务：意图判定用 orchestration 的 RuleBasedBackend，测量用 science-core 的
对齐口径 imt（共同支撑 + 对称 PDM）。此处只做 HTTP schema ↔ 领域对象 的映射。
"""

from __future__ import annotations

import base64

import numpy as np

from . import config, dataset
from .schemas import IMTResult, IntentResult, ModelInfo, TaskSpec

# science-core / orchestration（经 config 挂上 sys.path）
from glaux_imt.io.boundaries import Boundary  # noqa: E402
from glaux_imt.measurement.pdm import imt as _imt  # noqa: E402
from glaux_orchestrator.intent import ClaudeVLMBackend, RuleBasedBackend  # noqa: E402
from glaux_orchestrator.spec import Scope as _Scope  # noqa: E402

_rule = RuleBasedBackend()
_vlm = ClaudeVLMBackend()

_SCOPE_STR = {
    _Scope.IN_SCOPE: "in_scope",
    _Scope.AMBIGUOUS: "ambiguous",
    _Scope.OUT_OF_SCOPE: "out_of_scope",
}


def intent_backends() -> list[dict]:
    """意图后端注册表（供 UI 选择/显示可用性）。"""
    vlm_ok, vlm_reason = ClaudeVLMBackend.available()
    return [
        {"id": "rule", "name": "Rule-based", "available": True, "reason": "keyword classifier"},
        {"id": "vlm", "name": "Claude VLM", "available": vlm_ok, "reason": vlm_reason},
    ]


def interpret(
    nl: str,
    *,
    image_id: str | None,
    cubs_cf: float | None,
    backend: str = "rule",
    api_key: str | None = None,
    model: str | None = None,
) -> IntentResult:
    """NL(+图) → 三态守卫（真实 orchestrator）。非 in_scope 不带 spec。

    backend="vlm" 时用 Claude VLM 看图判定（密钥取 UI 传入或服务端 env）；
    不可用则抛 IntentBackendUnavailable（不静默退化）。
    """
    if backend == "vlm":
        image_b64 = None
        if image_id and config.data_available():
            try:
                image_b64 = base64.b64encode(dataset.image_png(image_id)).decode()
            except Exception:
                image_b64 = None
        r = _vlm.interpret(
            nl, image_path=image_id, cubs_cf=cubs_cf,
            has_image=image_b64 is not None, image_b64=image_b64,
            api_key=api_key, model=model,
        )
    else:
        r = _rule.interpret(nl, image_path=image_id, cubs_cf=cubs_cf, has_image=image_id is not None)
    spec = None
    if r.spec is not None:
        spec = TaskSpec(
            task="far_wall_cca_imt",
            image_id=image_id,
            cubs_cf=cubs_cf,
            roi=tuple(r.spec.roi) if r.spec.roi is not None else None,
        )
    return IntentResult(
        scope=_SCOPE_STR[r.scope],
        spec=spec,
        reason=r.reason,
        backend=getattr(r, "backend", None) or backend,
    )


def _boundary(name: str, pts: list[list[float]]) -> Boundary:
    arr = np.asarray(pts, dtype=float)
    return Boundary(name=name, x=arr[:, 0], y=arr[:, 1])


def measure(
    li: list[list[float]],
    ma: list[list[float]],
    cf: float,
    x_window: tuple[float, float] | None = None,
) -> IMTResult:
    """对齐口径测量：共同支撑 + 对称 PDM（内核 imt）。"""
    res = _imt(_boundary("LI", li), _boundary("MA", ma), cf, x_window=x_window)
    return IMTResult(
        mean_mm=round(float(res.mean_mm), 4),
        max_mm=round(float(res.max_mm), 4),
        pdm_mean_mm=round(float(res.pdm_mean_mm), 4),
        per_column_um=[round(float(v), 2) for v in np.asarray(res.per_column_um).ravel()],
        n_columns=int(res.n_columns),
    )


def models() -> list[ModelInfo]:
    """真实模型注册表——caroSegDeep（隔离/缓存）+ 数据集里出现的参考方法。"""
    known = {
        dataset.CARO: ("nl3769 · Dilated U-Net", "CUBS CREATIS baseline · Keras/TF 2.4.1 · far-wall + IMC", "isolated:uv/py3.8/TF2.4"),
        "GT-FAMUS": ("FAMUS · reference", "Fusion of experts — CUBS gold-standard reference", "reference"),
        "Manual-A1": ("Expert A1", "Manual tracing (gold)", "reference"),
        "Manual-A2": ("Expert A2", "Manual tracing", "reference"),
        "Computerized-CNR_IT": ("CNR Pisa", "First-order absolute moment edge operator", "reference"),
        "Computerized-POLITO_UNET": ("Politecnico di Torino", "U-Net segmentation of the IMC", "reference"),
    }
    out: list[ModelInfo] = [
        ModelInfo(
            id=dataset.CARO,
            pub=known[dataset.CARO][0],
            desc=known[dataset.CARO][1],
            active=True,
            backend=known[dataset.CARO][2],
        )
    ]
    if config.SEG_DIR.is_dir():
        for d in sorted(config.SEG_DIR.iterdir()):
            if not d.is_dir() or d.name == f"Computerized-{dataset.CARO}":
                continue
            pub, desc, be = known.get(d.name, (d.name, "CUBS reference method", "reference"))
            out.append(ModelInfo(id=d.name, pub=pub, desc=desc, active=False, backend=be))
    return out
