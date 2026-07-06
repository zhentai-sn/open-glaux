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

from glaux_orchestrator.spec import (
    TASKS,
    IntentResult,
    Scope,
    TaskSpec,
    TaskType,
    task_for_signals,
)


class IntentBackendUnavailable(Exception):
    """意图后端所需的 SDK / 密钥 / 权重不可用——显式失败。"""


# 测量/分割动作词（任务无关）
_MEASURE = ("测", "measure", "分割", "segment", "厚度", "thickness", "量", "circumference", "围")
# 明确超出当前能力的解剖/任务（既非颈动脉 IMT、也非胎儿头围）
_OUT_OF_SCOPE = (
    "心脏", "cardiac", "ef", "ejection", "射血", "左心室", "乳腺", "breast", "肿瘤",
    "tumor", "lesion", "甲状腺", "thyroid", "结节", "nodule", "腹围", "肝", "liver",
    "肾", "kidney", "斑块", "plaque", "股骨", "femur", "羊水", "amniotic",
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
    """确定性关键词映射——按任务注册表的信号词路由。图像不参与（纯文本启发式）。"""

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
        task = task_for_signals(text)  # 命中哪个已注册任务（IMT / HC / …）
        has_measure = any(k in text for k in _MEASURE)
        has_oos = any(k in text for k in _OUT_OF_SCOPE)

        # --- 命中某注册任务的信号词最优先 → in-scope（即便另含泛词）
        if task is not None:
            td = TASKS[task]
            spec = TaskSpec(
                task=task,
                image_path=image_path,
                cubs_cf=cubs_cf,
                roi=roi,
                method=td.default_method,
            )
            return IntentResult(Scope.IN_SCOPE, spec, f"识别为{td.label_zh}测量", self.name)

        # --- 明确的他解剖/他任务 → 超范围（当前仅支持已注册任务）
        if has_oos:
            supported = "、".join(t.label_zh for t in TASKS.values())
            return IntentResult(
                Scope.OUT_OF_SCOPE, None,
                f"目标超出当前能力（仅支持：{supported}）", self.name,
            )

        # --- 有测量/分割意图但目标不明 → 歧义，需澄清（不静默默认成某任务）
        if has_measure:
            return IntentResult(
                Scope.AMBIGUOUS, None,
                "识别到测量/分割意图但未指明目标解剖，需澄清测哪一项", self.name,
            )

        # --- 无可操作信号 → 歧义
        return IntentResult(
            Scope.AMBIGUOUS, None, "未识别到明确的测量任务，需澄清", self.name,
        )


# VLM 的守卫系统提示：把"意图理解是独立失败面 + 三态显式 + 多任务路由"写进判定契约。
_VLM_SYSTEM = """你是 Glaux（超声测量工作台）的意图分类器。当前支持两种测量任务：
- far_wall_cca_imt：颈动脉 B 型超声上测「远壁 CCA 内中膜厚度（IMT）」——两条壁线间厚度。
- fetal_hc：胎儿颅脑超声上测「头围（HC）」——沿颅骨轮廓拟合椭圆的周长。

给你用户的自然语言指令（可能含一张超声图）。经 report_intent 工具返回三态判定：
- in_scope：意图落到上面某个任务；此时必须在 task 字段给出对应任务名。
  若给了图，请让 task 与图像内容一致（颈动脉纵切 vs 胎头横切）——图文冲突时判 ambiguous。
- ambiguous：有测量/分割意图但目标不明、或指令与图像矛盾、信息不足需澄清——勿擅自默认。
- out_of_scope：目标是其它解剖/任务（心脏 EF、乳腺/甲状腺结节、肝肾、腹围、股骨长…）。

原则：宁可澄清或拒绝，绝不静默错跑。reason 用简洁中文说明判据（若看了图，点出图像证据）。"""

_VLM_TOOL = {
    "name": "report_intent",
    "description": "返回对用户意图的三态判定与目标任务。",
    "input_schema": {
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": ["in_scope", "ambiguous", "out_of_scope"]},
            "task": {
                "type": "string",
                "enum": ["far_wall_cca_imt", "fetal_hc"],
                "description": "scope=in_scope 时必填：命中的任务名；否则留空。",
            },
            "reason": {"type": "string", "description": "简洁判据（中文）"},
        },
        "required": ["scope", "reason"],
    },
}

_SCOPE_ENUM = {"in_scope": Scope.IN_SCOPE, "ambiguous": Scope.AMBIGUOUS, "out_of_scope": Scope.OUT_OF_SCOPE}
_TASK_ENUM = {"far_wall_cca_imt": TaskType.FAR_WALL_CCA_IMT, "fetal_hc": TaskType.FETAL_HC}


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
            task = _TASK_ENUM.get(str(data.get("task")))
            if task is None:  # in_scope 却没给合法任务名 → 降级为歧义，不臆造任务
                return IntentResult(
                    Scope.AMBIGUOUS, None,
                    f"{reason}（但未指明目标任务，需澄清）", self.name,
                )
            spec = TaskSpec(
                task=task, image_path=image_path, cubs_cf=cubs_cf, roi=roi,
                method=TASKS[task].default_method,
            )
        return IntentResult(scope, spec, reason, self.name)
