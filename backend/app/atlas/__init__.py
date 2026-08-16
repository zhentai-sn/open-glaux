"""Atlas · 图谱——人工策展的图文案例库（SDD 03）。

子模块：
- ``text``   标签归一与检索文本合成（纯函数）
- ``images`` 原图 / 裁剪图落盘（sha256 寻址）
- ``store``  LanceDB 案例表 + 引用记录表（写入幂等、FTS 检索、下架/恢复/删除门禁）

不变量：主进程只用 LanceDB / PIL 等数据 IO 库；VLM 描述由 agent-runtime 生成，
本包只存结果，绝不引入任何模型 SDK。
"""
