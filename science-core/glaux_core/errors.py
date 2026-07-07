"""内核异常层次.

设计原则（见纲领「验证层」与计划决策 #4）：**绝不静默输出无标定的假 IMT**。
标定不可得时必须显式抛错，让环境如实拒绝，而非返回一个看似合理的数。
"""


class GlauxError(Exception):
    """Glaux 内核所有异常的基类。"""


class CalibrationUnavailable(GlauxError):
    """某图的像素→mm 标定信息缺失或不可解析。

    由读取层（U2）在 CF 文件缺失/损坏时抛出，交由标定层（U3）决定
    降级路径（手动点选）或最终硬拒绝。
    """


class HardReject(GlauxError):
    """标定三档全部失败——环境拒绝为该图产出 IMT。

    这是刻意的终态：宁可拒绝，也不输出无标定的假测量。
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason
