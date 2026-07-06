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
        image_b64: str | None = None,
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
        image_b64: str | None = None,
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


# VLM 的守卫系统提示：把"意图理解是独立失败面 + 三态显式"写进它的判定契约。
_VLM_SYSTEM = """你是 Glaux（颈动脉超声 IMT 工作台）的意图分类器。v0 只做一件事：
从颈动脉 B 型超声图上测「远壁 CCA 内中膜厚度（far-wall CCA IMT）」。

给你用户的自然语言指令（可能含一张超声图）。只把意图判成三类之一，经 report_intent 工具返回：
- in_scope：用户要测远壁颈动脉 IMT（或等价：分割内中膜并给厚度）。
- ambiguous：有测量/分割意图但目标解剖不明、或信息不足需澄清——不要擅自默认成 IMT。
- out_of_scope：目标是别的解剖/任务（心脏 EF、乳腺/甲状腺结节、胎儿头围、肝肾、斑块最大径…）。

原则：宁可澄清或拒绝，绝不静默错跑。reason 用简洁中文说明判据（若看了图，可点出图像证据）。"""

_VLM_TOOL = {
    "name": "report_intent",
    "description": "返回对用户意图的三态判定。",
    "input_schema": {
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": ["in_scope", "ambiguous", "out_of_scope"]},
            "reason": {"type": "string", "description": "简洁判据（中文）"},
        },
        "required": ["scope", "reason"],
    },
}

_SCOPE_ENUM = {"in_scope": Scope.IN_SCOPE, "ambiguous": Scope.AMBIGUOUS, "out_of_scope": Scope.OUT_OF_SCOPE}


class ClaudeVLMBackend(IntentBackend):
    """真实 VLM 意图后端——看图 + NL，经受约束工具调用产出三态判定。

    需 ``anthropic`` SDK + ``ANTHROPIC_API_KEY``；缺任一显式抛 :class:`IntentBackendUnavailable`
    （不静默退化）。分类用受约束的 tool-use（强制 report_intent），保证输出可校验、无自由文本歧义。
    """

    name = "claude-vlm"

    def __init__(self, model: str = "claude-haiku-4-5-20251001", api_key_env: str = "ANTHROPIC_API_KEY") -> None:
        self.model = model
        self.api_key_env = api_key_env

    @classmethod
    def available(cls, api_key_env: str = "ANTHROPIC_API_KEY") -> tuple[bool, str]:
        """(是否可用, 原因)——供 UI/后端在不触发调用的前提下探测。"""
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return False, "缺少 anthropic SDK"
        if not os.getenv(api_key_env):
            return False, f"缺少 {api_key_env}"
        return True, "ready"

    def interpret(
        self,
        nl: str,
        *,
        image_path: str | None = None,
        cubs_cf: float | None = None,
        roi: tuple[int, int] | None = None,
        has_image: bool = False,
        image_b64: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> IntentResult:
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover - 环境相关
            raise IntentBackendUnavailable("ClaudeVLMBackend 需要 anthropic SDK") from exc
        key = api_key or os.getenv(self.api_key_env)
        if not key:
            raise IntentBackendUnavailable(f"缺少密钥（{self.api_key_env} 或 UI 填入）")

        content: list[dict] = []
        if has_image and image_b64:
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
            })
        content.append({"type": "text", "text": f"用户指令：{nl}"})

        try:
            client = anthropic.Anthropic(api_key=key)
            resp = client.messages.create(
                model=model or self.model,
                max_tokens=512,
                system=_VLM_SYSTEM,
                tools=[_VLM_TOOL],
                tool_choice={"type": "tool", "name": "report_intent"},
                messages=[{"role": "user", "content": content}],
            )
        except Exception as exc:  # 网络/鉴权/额度等——显式失败，不臆造规范
            raise IntentBackendUnavailable(f"VLM 调用失败：{type(exc).__name__}: {exc}") from exc

        block = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
        if block is None:
            raise IntentBackendUnavailable("VLM 未返回受约束的 report_intent 工具调用")
        data = block.input
        scope = _SCOPE_ENUM.get(str(data.get("scope")))
        if scope is None:
            raise IntentBackendUnavailable(f"VLM 返回未知 scope：{data.get('scope')!r}")
        reason = str(data.get("reason", "")).strip() or "（VLM 未给判据）"

        spec = None
        if scope is Scope.IN_SCOPE:
            spec = TaskSpec(
                task=TaskType.FAR_WALL_CCA_IMT, image_path=image_path, cubs_cf=cubs_cf, roi=roi,
            )
        return IntentResult(scope, spec, reason, self.name)
