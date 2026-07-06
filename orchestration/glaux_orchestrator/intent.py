"""NL/VLM → 结构化规范的**薄映射**（U9）。

意图理解是**与分割 CV 解耦的独立失败面**（计划决策 / 脑暴 §9#5）：这里只负责
把自然语言（+ 可选图像）判成 in-scope / ambiguous / out-of-scope，并在 in-scope
时产出确定的 :class:`TaskSpec`。歧义与超范围**显式返回**，绝不静默跑成错测量。

两个后端，同一契约（对齐分割层 ModelAdapter 的"接缝"模式）：
- :class:`RuleBasedBackend`：v0 确定性关键词映射，可复现、可测，聚焦 canonical 用例。
- :class:`ClaudeVLMBackend`：真实 VLM 接缝（看图 + NL）——隔离在接口后，需 SDK + 密钥，
  未接线时**显式报错**，绝不臆造规范。
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod

from glaux_orchestrator.spec import IntentResult, Scope, TaskSpec, TaskType


class IntentBackendUnavailable(Exception):
    """意图后端所需的 SDK / 密钥 / 权重不可用——显式失败。"""


# 颈动脉 IMT 的信号词（中英）
_CAROTID = ("imt", "intima", "media", "内中膜", "颈动脉", "cca", "carotid", "far wall", "远壁")
# 测量/分割动作词
_MEASURE = ("测", "measure", "分割", "segment", "厚度", "thickness", "量")
# 明确超出 v0 的解剖/任务（非颈动脉 IMT）
_OUT_OF_SCOPE = (
    "心脏", "cardiac", "ef", "ejection", "射血", "左心室", "乳腺", "breast", "肿瘤",
    "tumor", "lesion", "甲状腺", "thyroid", "结节", "nodule", "胎儿", "fetal",
    "head circumference", "头围", "腹围", "肝", "liver", "肾", "kidney", "斑块", "plaque",
)


class IntentBackend(ABC):
    """NL(+图) → IntentResult 契约。"""

    name: str = "abstract"

    @abstractmethod
    def interpret(
        self,
        nl: str,
        *,
        image_path: str | None = None,
        cubs_cf: float | None = None,
        roi: tuple[int, int] | None = None,
        has_image: bool = False,
    ) -> IntentResult:
        raise NotImplementedError


class RuleBasedBackend(IntentBackend):
    """确定性关键词映射（v0）。图像在此不参与判断（纯文本启发式）。"""

    name = "rule-based"

    def interpret(
        self,
        nl: str,
        *,
        image_path: str | None = None,
        cubs_cf: float | None = None,
        roi: tuple[int, int] | None = None,
        has_image: bool = False,
    ) -> IntentResult:
        text = (nl or "").lower()
        has_carotid = any(k in text for k in _CAROTID)
        has_measure = any(k in text for k in _MEASURE)
        has_oos = any(k in text for k in _OUT_OF_SCOPE)

        # --- 颈动脉 IMT 信号最优先：即便句中另含泛词也算 in-scope
        if has_carotid:
            spec = TaskSpec(
                task=TaskType.FAR_WALL_CCA_IMT,
                image_path=image_path,
                cubs_cf=cubs_cf,
                roi=roi,
            )
            return IntentResult(Scope.IN_SCOPE, spec, "识别为远壁 CCA IMT 测量", self.name)

        # --- 明确的他解剖/他任务 → 超范围（v0 只做颈动脉 IMT）
        if has_oos:
            return IntentResult(
                Scope.OUT_OF_SCOPE, None,
                "目标非颈动脉 IMT，超出 v0 能力（仅支持远壁 CCA 内中膜厚度）", self.name,
            )

        # --- 有测量/分割意图但目标不明 → 歧义，需澄清（不静默默认成 IMT）
        if has_measure:
            return IntentResult(
                Scope.AMBIGUOUS, None,
                "识别到测量/分割意图但未指明目标解剖，需澄清是否为颈动脉 IMT", self.name,
            )

        # --- 无可操作信号 → 歧义
        return IntentResult(
            Scope.AMBIGUOUS, None, "未识别到明确的测量任务，需澄清", self.name,
        )


class ClaudeVLMBackend(IntentBackend):
    """真实 VLM 接缝（Phase B）——看图 + NL 产出结构化规范。

    隔离在接口后：需 ``anthropic`` SDK + ``ANTHROPIC_API_KEY``；真实调用未接线，
    缺失时抛 :class:`IntentBackendUnavailable`，接线阶段落地（对齐 caroSegDeep 接缝）。
    """

    name = "claude-vlm"

    def __init__(self, model: str = "claude-opus-4-8", api_key_env: str = "ANTHROPIC_API_KEY") -> None:
        self.model = model
        self.api_key_env = api_key_env

    def interpret(
        self,
        nl: str,
        *,
        image_path: str | None = None,
        cubs_cf: float | None = None,
        roi: tuple[int, int] | None = None,
        has_image: bool = False,
    ) -> IntentResult:
        try:
            import anthropic  # noqa: F401
        except ImportError as exc:  # pragma: no cover - 环境相关
            raise IntentBackendUnavailable(
                "ClaudeVLMBackend 需要 anthropic SDK：pip install anthropic"
            ) from exc
        if not os.getenv(self.api_key_env):
            raise IntentBackendUnavailable(f"缺少 {self.api_key_env}")
        # TODO(接线阶段)：VLM 看图 + NL → 受约束 JSON（task/roi/method）→ 校验成 TaskSpec。
        # 属执行期未知，需真实 API + 图像跑通后落地；此处不臆造实现。
        raise NotImplementedError(
            "真实 VLM 意图解析未接线——见计划 U9 Phase B（需 anthropic + 密钥 + 受约束解码）"
        )
