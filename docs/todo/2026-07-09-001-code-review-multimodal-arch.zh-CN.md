---
kind: record
status: open
title: "review: feat/multimodal-arch 全分支代码评审——待办清单"
type: review
created: 2026-07-09
scope: feat/multimodal-arch (vs main)
---

# feat/multimodal-arch 全分支代码评审 · 待办清单

> **用途**：对分支 `feat/multimodal-arch`（相对 `main` 的整体 diff，main 上只有 4 个纯文档提交，
> 故此 diff 等于全部应用代码——19048 行 / 124 文件）跑的一轮结构化代码评审，产出的可执行待办清单。
> **日期**：2026-07-09。
> **方法**：4 个子代理并行，按 science-core / backend / orchestration / frontend 四层分别通读全量当前文件
> （非仅 diff 片段）+ 交叉核对相邻层，backend 一层额外起了真实服务用 curl 做了实测验证（路径穿越 /
> 异步阻塞 / CORS / API key 泄露等假设）。**未重跑三套 pytest 全量回归**——当前环境（Windows 经
> `\\wsl.localhost` 访问 WSL 内建的 `.venv`）下 `uv run pytest` 因符号链接问题跑不通，这是本轮评审的
> 已知局限，非代码本身问题。
> **半衰期提醒**：以下 file:line 定位于评审当时的 HEAD（`7cfd980` VS Code 式可停靠布局 P5b）；后续提交
> 可能已使部分行号漂移或问题已被顺带修复，动手前先确认现状。

## 一页纸

四层的架构纪律总体扎实——校准硬拒绝、进程隔离（主进程无 TF/torch）、三态守卫、注册表无分支这些"护城河"
级不变量是真落实的，不是文档自嗨。但发现 **2 个 Critical + 3 个 High**，集中在：

1. 前端编辑回流失败时静默丢修正、不回滚、不提示；
2. 一条存储型 XSS → 明文存储的 VLM API key 泄露链路；
3. 后端 `/interpret` 端点异常兜底会绕开整套三态守卫。

建议这三类问题在合并到 `main` / 对外验证前先修；HC 椭圆检测缺合理性校验建议同批处理；其余 Medium/Low
按优先级排入后续清理。

---

## Critical

- [ ] **① 编辑回流失败无回滚、无提示** —— [frontend/src/components/CornerstoneViewer.tsx:371](../../frontend/src/components/CornerstoneViewer.tsx)（`onPointerUp`）
  拖拽边界后 `await api.taskMeasure(...)` 失败时 `catch` 块为空（注释"后端失败保留预览值"），但"预览值"
  只是客户端 `deform()` 高斯形变的本地估算，从未经过 `/task/measure` 校验。失败时：`store.metrics` /
  `store.primitives` 都不更新（两个 setter 都在 `try` 内），面板显示的还是拖动前的旧测量值，但画布上的
  边界已经是拖动后的新位置——**数值和几何显示不一致，且没有任何错误提示或"未保存"标记，也不会自动回滚
  `work.current`**。
  **失败场景**：用户拖动 LI 边界手柄，`/task/measure` 超时或 500 → 边界视觉上已移动，IMT 面板还是旧值，
  没有任何东西告诉用户这次修正没生效。医学测量工具里这是可信度硬伤。
  **修复方向**：`catch` 块里对 `work.current` 回滚到编辑前快照 + 用户可见的失败提示（toast / 状态栏）。

- [ ] **② 存储型 XSS → VLM API key 泄露链路** —— [frontend/src/components/Rich.tsx:17](../../frontend/src/components/Rich.tsx) + [frontend/src/i18n/index.tsx:29-32](../../frontend/src/i18n/index.tsx)
  `Rich` 组件用 `dangerouslySetInnerHTML` 渲染 `t(k, vars)`；`interpolate()` 对 `vars[k]` 做原始正则替换，
  **不做 HTML 转义**。文件里的注释("内容全部来自内建静态字典...非用户输入 → dangerouslySetInnerHTML 安全")
  只对了一半——**模板**是静态的，但插值变量不是，以下三处的值来自后端可扩展注册表（"插件市场"的设计目标
  就是让第三方能力可插拔）：
  - [AgentPanel.tsx:188](../../frontend/src/components/AgentPanel.tsx)：`vars: { model: c.id }`，`c.id` 来自 `GET /capabilities`；
  - [CornerstoneViewer.tsx:388](../../frontend/src/components/CornerstoneViewer.tsx)：`vars: { w: d.role, ... }`，`d.role` 来自 `GET /tasks` 的 `TaskOverlaySpec.role`；
  - [useAgent.ts:49](../../frontend/src/hooks/useAgent.ts)：`vars: { task: wantLabel }`，来自 `GET /tasks` 的 `TaskView.label`。

  叠加 [store/session.ts:134,166](../../frontend/src/store/session.ts) 把 Claude VLM API key **明文存 localStorage**
  （`glaux.vlmKey`），且 `index.html` 无 CSP——任一注册表字段被注入 `<img src=x onerror=...>` 即可在页面里
  执行脚本，进而读取 `localStorage.getItem("glaux.vlmKey")` 外泄密钥。
  **失败场景**：能力注册表返回一条 `id` 含恶意 payload 的记录（后端 bug / 被篡改的插件条目 / 中间人篡改
  dev 代理），用户打开市场点一下该卡片即触发。
  **修复方向**：`interpolate()` 增加 HTML 转义（或改用 React 安全插值而非 `dangerouslySetInnerHTML`）；
  API key 若必须留在前端，至少加 CSP 收紧、评估是否该走后端 session 而非 localStorage 明文。

## High

- [ ] **③ 编辑请求无序列化保护，存在竞态** —— 同 ①，[CornerstoneViewer.tsx:371-393](../../frontend/src/components/CornerstoneViewer.tsx)
  全文件搜索确认没有 `AbortController` / 序列号 / in-flight 保护。连续两次快速拖拽会并发发出两个
  `/task/measure`，谁先返回谁生效，与谁先发出无关——慢响应可能用过期的编辑覆盖用户最新的修正。
  **修复方向**：加请求序列号或 `AbortController`，只接受"最新一次发出"的响应。

- [ ] **④ `/interpret` 异常兜底绕开三态守卫** —— [backend/app/routers/api.py:66-79](../../backend/app/routers/api.py)（`orchestration` 子代理审查时顺带在 backend 侧发现的联动风险）
  `/interpret` 端点捕获宽泛 `except Exception` 后静默回退到 [mock.classify](../../backend/app/mock.py)
  （`mock.py:31-54`），而这个 mock 是多模态改造前的遗留物——`_CAROTID`/`_OUT_OF_SCOPE` 列表只认识 IMT，
  完全不知道 `fetal_hc` 任务。一旦真实 orchestrator 抛出非预期异常（不是显式的 `IntentBackendUnavailable`），
  请求会被这个过期 mock 重新分类，可能把 HC 请求误判为 out_of_scope 或反之——**这是三态守卫本该杜绝的
  "静默错跑"类问题在系统边界上重新被引入**。
  **修复方向**：`/interpret` 异常兜底要么让 HC 感知（更新 mock 覆盖两个任务），要么直接对未预期异常返回
  显式 503/错误而非静默降级到旧分类器。

- [ ] **⑤ HC 椭圆检测无解剖学合理性校验** —— [science-core/glaux_core/segmentation/contour.py:96-131](../../science-core/glaux_core/segmentation/contour.py)（`BrightRingEllipseAdapter.detect`）
  只按亮度百分位阈值取轮廓，没有任何尺寸/位置/长宽比合理性校验；下游
  [measurement/hc.py](../../science-core/glaux_core/measurement/hc.py) 也只查 `cf > 0`。任何非颅骨的
  高亮结构（卡尺标记、文字叠加、增益伪影、其他解剖结构）占据足够亮区时，会被自信地拟合成一个**看起来合理
  但临床错误**的头围——正是本轮评审重点要抓的"静默给错数"这一类最坏问题（缓解因素：这是早期启发式适配器，
  非生产用的 caroSegDeep 同级路径，但已有测试覆盖，说明有生产化倾向）。
  **修复方向**：加尺寸/长宽比/图像内位置的合理性阈值，越界时走硬拒绝而非静默产出。

## Medium

- [ ] `dataset.py` demo 队列范围可被绕过 —— [backend/app/dataset.py:45-49,78-86](../../backend/app/dataset.py)。
  `cf_of()`/`image_png()` 直接拼路径，未复用 `list_ids()` 的 `_TECH_RE`/demo 队列白名单；实测
  `GET /image/tech_001` 能读到不在策展队列（tech_401–500）内的图，`/task/run` 同理，只是偶然被
  "caroSegDeep 无缓存"挡住而非设计如此。若 401–500 这个边界本意是访问控制而非仅策展分类，需要补校验。

- [ ] `task_measure` 对畸形 primitive 返回 500 而非 422 —— [backend/app/routers/api.py:147-155](../../backend/app/routers/api.py)。
  只捕获 `ValueError`；缺 `id`/`role`/`points` 等字段的 primitive 会在 `contracts.py` 的原始 dict 访问处
  抛 `KeyError`，实测直接 500。应一并捕获 `KeyError`/`TypeError` 转 422。

- [ ] 子进程重模型调用无并发上限 —— [backend/app/segment_proc.py:43-68](../../backend/app/segment_proc.py)、[backend/app/hc_real.py:84-103](../../backend/app/hc_real.py)。
  N 个并发未缓存请求会同时拉起 N 个 TF/torch 子进程，有资源耗尽风险，建议加信号量/队列上限。

- [x] ~~规则后端里任务信号词命中即刻判 in_scope~~ （意图层已于 2026-08-16 随 orchestration/ 退役，见 docs/designs/2026-08-16-001-retire-orchestration；本条失效） ，忽略同句里的 OOS 词 —— [orchestration/glaux_orchestrator/intent.py:75-93](../../orchestration/glaux_orchestrator/intent.py)。
  `has_oos` 在信号词命中分支里根本不会被求值；本该判 ambiguous 的"一句话里既有任务词又有明确超范围词"
  的情况被静默吃掉。

- [ ] IMT/HC 信号词同句命中时静默判给注册顺序在前者 —— [science-core/glaux_core/tasks.py（`task_for_signals`，2026-08-16 自 orchestration 迁入）](../../science-core/glaux_core/tasks.py)（`task_for_signals`）。
  遍历 `REGISTRY`（dict，插入序 IMT 先于 HC）返回第一个匹配任务而非"唯一匹配"，两个任务的信号词同时命中
  时不会触发 ambiguous——注册表本该顺序无关，这里悄悄引入了隐式优先级。

- [ ] 残留硬编码模态分支 —— [frontend/src/components/TitleBar.tsx:9-11](../../frontend/src/components/TitleBar.tsx)、[SideBar.tsx:86-91](../../frontend/src/components/SideBar.tsx)（`ExplorerView`）。
  `isHC = modality === "fetal_hc"` 决定文件后缀/目录名等，与 `b47c244`（"消灭 UI 层最后的逐模态尾巴"）
  的既定目标不一致，加第三个模态时这两处仍要改前端代码。

- [ ] 布局持久化未真正做版本/schema 校验 —— [frontend/src/components/Shell.tsx:73-88](../../frontend/src/components/Shell.tsx)。
  commit `7cfd980` 声称"损坏/跨版本回默认"，但实际只 try/catch 了 `JSON.parse`/`fromJSON` 抛异常的情况，
  没有对存储 blob 本身做版本号/schema 校验——结构合法但语义过期的布局（例如未来改了面板 id）会被静默
  接受而非回默认。

- [ ] `deform()` 高斯形变除零风险 —— [frontend/src/components/CornerstoneViewer.tsx:27-28,332](../../frontend/src/components/CornerstoneViewer.tsx)。
  边界点近乎共 x 时 `sigma → 0`，`Math.exp(-(...)/(2*sigma*sigma))` 产生 `NaN` 坐标，无下限保护；现实触发
  概率低（壁对边界通常近水平）但无防护。

- [ ] 校准分桶为空时无法区分"无数据"与"真校准失败" —— [science-core/glaux_core/verification/uncertainty.py:70](../../science-core/glaux_core/verification/uncertainty.py)。
  `separation_ok` 在某一分桶为空、`conf_mae`/`uns_mae` 变 `NaN` 时恒为 `False`。

- [ ] 两行式边界数据格式嗅探误判 —— [science-core/glaux_core/io/cubs.py:82](../../science-core/glaux_core/io/cubs.py)（`read_profile`）。
  会把合法的"两行存储的 2 点边界"误判成逐点数据，静默产出错误坐标而非报错，触发窗口窄但是静默腐化数据。

- [ ] `IMTResult` 字段语义易混淆 —— [science-core/glaux_core/measurement/pdm.py:71-77](../../science-core/glaux_core/measurement/pdm.py)。
  `mean_mm`（非对称，LI→MA 单方向）和 `pdm_mean_mm`（对称但全局均值）两个字段名容易混淆，跨方法比较时
  选错字段会拿到错误数值（目前 `eval/harness.py` 用对了，接口本身是个坑，建议加更强的 docstring 警告或
  改名）。

- [ ] 终端输出与对话历史无上限增长 —— [frontend/src/components/TerminalView.tsx:17,32](../../frontend/src/components/TerminalView.tsx)、[frontend/src/store/session.ts:180-182](../../frontend/src/store/session.ts)。
  长会话反复跑命令会让两个数组无界增长，无环形缓冲/最大长度策略。

## Low（影响小，按优先级顺手清）

- [ ] `io/contour.py:128` 椭圆圆心求解未包 try/except，近奇异矩阵抛裸 `LinAlgError` 而非模块统一的 `ValueError`。
- [ ] `io/hc18.py:63` `filename[:-4]` 盲切 4 字符假设一定是 `.png`，无校验。
- [ ] `io/hc18.py:34` `_ID_RE` 正则定义但从未使用（死代码），HC18 image id 未做命名模式校验（对比 `cubs.py` 的 `_IMAGE_ID_RE` 是真用了的）。
- [ ] `artifacts/overlay.py:26,28` `astype(np.uint8)` 无裁剪/缩放地强转，float `[0,1]` 或 16-bit 输入会静默产出近黑或环绕垃圾图（仅影响展示叠加图，非测量路径）。
- [ ] `measurement/hc.py` 的 `head_circumference()` 与 `hc_from_ellipse()` 几乎复制粘贴（含重复的 `cf>0` 校验），值得合并。
- [ ] `measurement/pdm.py:47-49` `polyline_distances` 纯 Python 逐点循环，O(N·M)，eval 批量跑 500 图×多方法时有可避免的开销（不影响正确性，仅批量评测耗时）。
- [ ] `backend/app/routers/api.py:93-102` `/image/{image_id}` 无格式/正则约束，目前靠 Starlette 单段路由转换器意外挡住了经典路径穿越（`../`、`%2F` 实测均 404），但这是"意外防御"不是"设计防御"。
- [ ] `backend/app/routers/api.py:74-79` VLM 调用失败时把原始 SDK 异常字符串（类型名+消息）透传进 503 响应体，属低价值信息泄露（未泄露 key 本身）。
- [ ] `backend/app/kernel.py:174` vs `:156-158` contour(HC) 分支的硬拒绝保护是隐式跨文件耦合（依赖 `hc18.py` 的 dict 查找必然命中），不像 wall_pair(IMT) 分支那样局部显式 `if not cf: raise`。
- [ ] `backend/app/routers/api.py:83` `job: str | None = None` 查询参数声明了但函数体从未读取，死参数。
- [ ] `backend/app/routers/api.py:118-155` 三个 `/task/*` handler 重复同一套 `KERNEL_OK` 守卫 + try/except 脚手架，可提取共享装饰器。
- [x] ~~`orchestration/glaux_orchestrator/run.py:56-73`~~ （意图层已于 2026-08-16 随 orchestration/ 退役，见 docs/designs/2026-08-16-001-retire-orchestration；本条失效）  `interpret_and_run` 的 `has_image` 恒为 `True` 但从未真正传 `image_b64`，若被 `ClaudeVLMBackend` 走这条路径会静默退化为纯文本判断（目前没有调用方这样用，是接口误用陷阱而非活跃 bug）。
- [x] ~~`orchestration/glaux_orchestrator/intent.py:121-137`~~ （意图层已于 2026-08-16 随 orchestration/ 退役，见 docs/designs/2026-08-16-001-retire-orchestration；本条失效）  VLM tool-use schema 无置信度字段，三态守卫对"模型自信但判断错误"没有结构性防线，只靠 prompt 软约束。
- [x] ~~`orchestration/glaux_orchestrator/intent.py:41-52`~~ （意图层已于 2026-08-16 随 orchestration/ 退役，见 docs/designs/2026-08-16-001-retire-orchestration；本条失效）  `IntentBackend` 抽象签名与 `ClaudeVLMBackend` 具体实现（多了 `api_key`/`model` 参数）不一致，多态调用方结构上传不了这两个参数。
- [ ] `science-core/glaux_core/tasks.py`（原 orchestration/tasks.py:169-172，2026-08-16 迁入）HC 的 `"hc"` 信号词是纯子串匹配，非单词边界，理论上任何含相邻字母 "h"+"c" 的文本都会误触发（实践中碰撞窗口很窄）。
- [ ] `frontend/src/components/Shell.tsx:90-96` `api.onDidLayoutChange` 订阅从未在卸载时释放（`Shell` 是顶层单例，正常使用不受影响，但给后续加面板立了个坏先例）。
- [ ] `frontend/src/components/CornerstoneViewer.tsx:344-348` `setCoords` 在每次 `pointermove` 都写全局 store，无节流，拖拽/平移时 `StatusBar` 以鼠标事件速率重渲染。
- [ ] `frontend/package.json:16` `@cornerstonejs/tools` 声明了依赖但整个 diff 里从未 import（设计上刻意不用 CS3D 内置标注工具），属死依赖体积。
- [ ] `frontend/src/components/CornerstoneViewer.tsx:323` 手柄搜索只匹配 `p.kind === "polyline"`；未来若有可编辑椭圆叠加层，拖拽会静默落空到平移模式而非报"暂不支持"，先占个 TODO。

---

## 验证时确认没问题的部分（供后续参考，避免重复排查）

- 主 FastAPI 进程无 TF/torch 依赖（有测试断言 `find_spec("tensorflow") is None`）；重模型全部走隔离子进程
  + 缓存优先。
- backend 子进程调用一律 argv 列表形式（非 `shell=True`）+ 显式 minimal `env=`，无命令注入面。
- backend 所有路由 handler 是同步 `def`（非 `async def`），FastAPI 自动丢线程池处理，同步 subprocess/文件 IO
  不会阻塞事件循环。
- CORS 仅放行 `localhost:5173`/`127.0.0.1:5173`，无通配符 origin。
- VLM API key 全链路不落日志、不回显；`/image/{id}` 经 Starlette 路由层实测挡住了经典路径穿越 payload。
- IMT 主路径（wall_pair）校准硬拒绝端到端可用，缺 `cf` 一律 422，不会静默产出假测量值。
- 三态守卫在 `orchestration` 层内部的失败处理是保守的：VLM 响应缺 tool_use 块/未知 scope/task 缺失等情况
  全部显式拒绝或降级为 ambiguous；`TaskSpec`/`IntentResult` 的不变量在 dataclass `__post_init__` 层面结构性
  强制。
- `run_spec`/注册表分发在 `orchestration/` 内确认无 `if task == "imt"` 式残留分支；`backend/app/kernel.py`
  唯一保留的 `adapter_kind` 分支是数据入口层的合理分支（不同数据源形状不同），非任务逻辑分支。
- 前端椭圆参数化、坐标系、单位口径与后端 `io/contour.py` 逐字节核对一致；PDM 点到折线投影正确裁剪到线段
  范围，有已知解析解回归测试；common-support 跨方法窗口对齐有专门测试覆盖真实方法学陷阱。
- P2.5 端点清理确认干净：grep 无残留旧路由；`Editor.tsx`/`Viewer.tsx`/`ActivityBar.tsx`/`MarketplaceView`/
  `BottomPanel.tsx` 确认零模态分支（与 Medium 里列出的 `TitleBar`/`SideBar.ExplorerView` 两处残留形成对比）。
- 终端命令分发（`run <nl>` 等）全部走纯文本 React 渲染，不经过 `eval`/URL 拼接/`dangerouslySetInnerHTML`，
  非注入面。

## 变更记录
- **2026-07-09**：v1。首次评审，4 子代理并行覆盖 science-core/backend/orchestration/frontend 全量 diff
  （vs `main`，19048 行），产出本清单。
