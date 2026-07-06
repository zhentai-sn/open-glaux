# 实现计划 · Glaux IDE 前端（FastAPI + React）

> **用途**：把[前端设计稿与交互需求清单](../designs/2026-07-06-glaux-ide-frontend.zh-CN.md)（R1–R14）
> 拆成可执行、带优先级的实现单元与里程碑，作为 Phase B 外壳（U10/U11）的落地路线。
> **日期**：2026-07-06 · **类别**：plan（计划） · **状态**：v1 · **技术栈**：FastAPI + React(Vite/TS) + i18next
> **依据**：[设计稿](../designs/2026-07-06-glaux-ide-frontend.zh-CN.md) · [科学内核计划 Phase B](2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md)（U9 已成、U10/U11 待包） · [纲领](../roadmaps/charter.zh-CN.md)
> **前置事实**：科学内核（U1–U8）+ 编排骨架（U9）已成并真数据验证；caroSegDeep 真模型在隔离
> uv/py3.8/TF2.4 环境跑通（vs A1 |bias| 66.6µm）。本计划只做**外壳与接线**，不动确定性内核。

---

## 一、目标与范围

**目标**：把已验证的科学内核 + 编排层，包成设计稿定义的 VS Code 式 IDE，让真实研究者能
「选真图 → 智能体分割测量 → 拖边界修正 → 结果入库」，即成功标准里的**低风险试一把**。

**之内**：`frontend/`(React) + `backend/`(FastAPI) 两个新工程；把 §5 契约的端点接到 science-core /
orchestration / caroSegDeep 隔离环境；实现 R1–R14 的 P0（附带部分 P1）。

**之外**：多用户/云多租户、模型训练。
（原列「真实 VLM」「非颈动脉解剖」已先后落地：VLM 已接线，胎儿头围作为第二模态经任务注册表接入——见进度表附项。）

**贯穿的三条不变量**（继承内核，UI 必须体现）：测量确定性 · 意图守卫（歧义/超范围显式） · 标定硬拒绝。

---

## 二、关键决策

1. **前后端分离，后端薄**：FastAPI 只做编排/IO/进程隔离的 HTTP 外壳，业务在 science-core/
   orchestration；不把逻辑搬进后端。
2. **分割后端进程隔离**：`/segment` 经子进程/本地服务调 caroSegDeep 的 uv/py3.8/TF2.4 环境，
   **FastAPI 主进程不引入 TF**（沿用 `ModelAdapter` 隔离，见 `eval/README`）。
3. **IMT 前端可估、后端为准**：拖拽时前端即时估算给反馈，松手走 `/measure` 取对齐口径权威值——
   数字确定性仍在内核。
4. **i18n 键表先行**：直接迁设计稿键表，键名冻结，避免后期返工。
5. **先真闭环再完善**：M0 脚手架 → M1 真数据最小闭环（demo 可跑）→ M2 修正回流 → M3 完善 → M4 桌面壳。

---

## 三、高层数据流

```
React(前端) ──HTTP──> FastAPI(backend/)
  Explorer   → GET /images, GET /image/{id}            → io.cubs.read_dataset + tiff→PNG
  Agent 指令 → POST /interpret                          → glaux_orchestrator.intent（三态守卫）
             → POST /run(TaskSpec) / POST /segment      → run_spec → 分割适配器(隔离子进程)
  Canvas 测量→ POST /measure(li,ma,cf,x_window)         → measurement.pdm.imt（共同支撑+对称PDM）
  修正      → POST /correction                          → 记忆层 schema(U7)
  Models    → GET /models, POST /segment(model)         → ModelAdapter 注册表
```

---

## 四、目录结构（新增）

```
open-glaux/
├── backend/                         # FastAPI 外壳（薄）
│   ├── app/main.py  routers/  adapters/segment_proc.py(隔离子进程调用)
│   └── pyproject.toml               # 依赖 science-core + orchestration（不含 TF）
├── frontend/                        # React + Vite + TS
│   ├── src/components/{ActivityBar,SideBar,Editor,AgentPanel,BottomPanel,StatusBar}/
│   ├── src/store/session.ts  src/i18n/{en,zh}.ts  src/api/client.ts
│   └── package.json
```

---

## 五、实现单元与优先级

> **P0**=v1 必须（低风险 demo 的验收线） · **P1**=v1 应有 · **P2**=可延后。
> 单元 id `F*` 稳定；对应设计稿需求 R*。

### 里程碑 M0 · 脚手架与外壳

| id | 单元 | 优先级 | 依赖 | 覆盖 | 验收 |
| --- | --- | --- | --- | --- | --- |
| **F1** | 双工程脚手架（FastAPI + React/Vite/TS，dev 脚本、lint） | **P0** | 设计稿 | R1 | `make dev` 两端起，前端打开空壳 |
| **F2** | IDE 八区外壳 + 设计 token（CSS 变量/主题）+ 响应式 | **P0** | F1 | R1,R2,R6,R10 | 布局与 mockup 一致，三断点生效 |
| **F3** | i18n 基座（en/zh 键表迁移、状态栏切换、默认语言+localStorage） | **P0** | F2 | R11 | 全 chrome 一键中英切换 |
| **F4** | 后端 mock 端点（六端点返假数据 + OpenAPI） | **P0** | F1 | R14 | 前端可对 mock 联调 |

### 里程碑 M1 · 真数据最小闭环（**demo 成立线**）

| id | 单元 | 优先级 | 依赖 | 覆盖 | 验收 |
| --- | --- | --- | --- | --- | --- |
| **F5** | 数据集接入：`/images`+`/image` 接 `read_dataset`+tiff→PNG；Explorer 载真实树、选图开编辑器 | **P0** | F2,F4 | R3,R5 | 真实 CUBS 树可浏览，选图载入画布 |
| **F6** | 影像画布 + LI/MA/ROI 叠加 + 比例尺 + 工具浮层 | **P0** | F5 | R7 | 真图 + 叠加正确、比例尺由 CF 算 |
| **F7** | 分割接入（隔离环境）：`/segment` 经 caroSegDeep 子进程/预算输出 | **P0** | F6 | R7,R14 | 真模型出 LI/MA 载入画布，主进程无 TF |
| **F8** | 测量接入：`/measure` 接对齐口径 `imt`；Measurements 面板 | **P0** | F6 | R9 | 真实 IMT/max/PDM/vs A1 落面板 |
| **F9** | 智能体三态闭环：`/interpret` 接 orchestrator；四步+提议+澄清/拒绝；Run 动作 | **P0** | F4→F5–F8 | R8,R12 | in/amb/oos 三态可见，守卫不静默错跑 |

> **M1 达成 = 低风险试一把 demo：真研究者选真图 → Agent 跑通 → 看到真实 IMT。**

### 里程碑 M2 · 人机协同修正（护城河）

| id | 单元 | 优先级 | 依赖 | 覆盖 | 验收 |
| --- | --- | --- | --- | --- | --- |
| **F10** | 边界修正交互：Edit LI/MA 拖手柄 → 前端即时估算 → 松手 `/measure` 权威值 → 来源=human | **P0** | F6,F8 | R7 | 拖动即时反馈，权威 IMT 与来源翻转正确 |
| **F11** | 修正回流记忆层：`/correction` 落 U7 schema；SCM 视图显未提交修正 | **P1** | F10 | R5,R14 | 修正携 provenance 入库、SCM 可见 |
| **F12** | Accept/队列：提议 Accept → 写 cohort；对话历史保留（切语言不清空） | **P1** | F9 | R8,R9 | Accept 落队列、历史留存 |

### 里程碑 M3 · 完善

| id | 单元 | 优先级 | 依赖 | 覆盖 | 验收 |
| --- | --- | --- | --- | --- | --- |
| **F13** | Models 扩展：`/models` 列适配器 + 切换 active + 重跑分割 | **P1** | F7 | R4 | 切模型重出分割，徽标同步 |
| **F14** | 底部面板完备：Output(内核日志) / Problems(硬拒绝·超生理·低置信告警) | **P1** | F8,F9 | R9 | 告警正确、无则「未检出问题」 |
| **F15** | 状态与边界态：加载/空/错误/**硬拒绝**态 UI | **P1** | F5–F9 | R12 | 缺 CF 走硬拒绝、不出假 IMT |
| **F16** | 无障碍/键盘：焦点、快捷键(V/L/M/R)、reduced-motion、色觉可辨 | **P1** | F2,F6 | R13 | 键盘全可达、焦点可见 |
| **F17** | 搜索/SCM 深化：过滤 + 修正 diff（前后叠加 + ΔIMT） | **P2** | F5,F11 | R5 | 可按 id/中心/method 过滤、diff 可看 |

### 里程碑 M4 · 桌面壳（= U10）

| id | 单元 | 优先级 | 依赖 | 覆盖 | 验收 |
| --- | --- | --- | --- | --- | --- |
| **F18** | Tauri/Electron 封装 + 打包；本地算力经隔离服务 | **P2** | M1–M3 | 纲领(本地/桌面) | 单机可装可跑，重算力经隔离环境 |

---

## 六、优先级总览与排序

```
P0（v1 必须，构成 demo 验收线）：F1 F2 F3 F4 · F5 F6 F7 F8 F9 · F10
P1（v1 应有）：                   F11 F12 · F13 F14 F15 F16
P2（可延后）：                    F17 · F18(桌面壳)
```

**推荐排序**：M0(F1→F2→F3‖F4) → M1(F5→F6→F7‖F8→F9) → M2(F10→F11→F12) → M3(并行 F13–F16) → M4(F18)。
`‖` 表示可并行。**关键路径 = F1→F2→F5→F6→F7/F8→F9→F10**（真闭环 + 修正），先打通再横向铺完善。

---

## 七、成功标准

| 维度 | 阈值 |
| --- | --- |
| **demo 成立（M1）** | 真研究者用真实 CUBS 图，NL 驱动 → 看到真实 IMT（与内核 `/measure` 一致）|
| **守卫可见（M1）** | 歧义/超范围/硬拒绝三态在 UI 显式呈现，无静默错跑/无标定假值 |
| **协同修正（M2）** | 拖边界即时重测、来源翻转 human、修正携 provenance 入记忆层 |
| **模型无关（M3）** | 切换分割适配器不改内核，UI 与徽标同步 |
| **双语（贯穿）** | 全 chrome + 智能体动态发言中英一键切换 |

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| caroSegDeep 隔离环境经 HTTP/子进程调用的延迟与稳定性 | 分割慢/偶发失败 | `/segment` 异步 + 预算输出兜底 + 加载态(F15)；批量预跑缓存 |
| 前端估算 IMT 与后端权威值不一致造成困惑 | 信任受损 | 明确「拖拽=预览、松手=权威」；松手前标未定态 |
| i18n 键后期返工 | 大面积改动 | 键表先冻结(F3)；动态发言也纳入字典 |
| 真实图像许可与隐私 | 合规 | 研究数据集(CC BY)优先；示意渲染显式标注；真图不入库 |

## 九、实现进度

| 里程碑 | 单元 | 状态 | 备注 |
| --- | --- | --- | --- |
| **M0** | F1 双工程脚手架 | ✅ 完成 | `backend/`(FastAPI) + `frontend/`(Vite+React+TS) + 根 `Makefile`；typecheck/lint/build 全绿 |
| **M0** | F2 八区外壳 + token + 响应式 | ✅ 完成 | 八区组件树 + §2 token(tokens.css) + 1120/820 断点；由 mockup 1:1 迁移 |
| **M0** | F3 i18n 基座 | ✅ 完成 | en/zh 键表冻结(类型强制对齐)、状态栏一键切换、navigator+localStorage 默认；智能体发言走字典 |
| **M0** | F4 后端 mock 端点 + OpenAPI | ✅ 完成 | §5 八端点 mock（真实验证数值）+ 规则三态守卫 + stdlib 合成 PNG；主进程无 TF；pytest 9/9 |
| **M1** | F5 数据集接入 | ✅ 完成 | /images+/image 接 science-core io（tech_401–500 演示队列）；真 tiff→PNG（PIL）；Explorer 真实树、选图开编辑器 |
| **M1** | F6 画布真图+真边界 | ✅ 完成 | 画布载真 B-mode PNG + 真实 LI/MA/ROI 叠加 + 比例尺由真实 CF 算 |
| **M1** | F7 分割接入 | ✅ 完成 | /segment 走 caroSegDeep 缓存优先（eval 100 图真实产出）+ .venv-csd 隔离子进程兜底；主进程无 TF |
| **M1** | F8 测量接入 | ✅ 完成 | /measure 接对齐口径 imt（共同支撑+对称 PDM）；/run 组装标定→分割→测量+vs A1；Measurements 面板落真值 |
| **M1** | F9 智能体三态闭环 | ✅ 完成 | /interpret 接真实 orchestrator；in_scope 走真实四步跑批出真实提议；amb/oos 澄清/拒绝可见 |
| **M2** | F10 拖边界即时重测 | ✅ 完成 | 画布重写：滚轮缩放/平移 + 拖 LI/MA 手柄高斯形变 → 松手 /measure 权威值 + 来源翻 human + 重测回话 |
| 附 | MVP 收敛空壳感 | ✅ 完成 | 去装饰控件（菜单/假标签/设置/铃/假市场）、未做模块标 WIP、ErrorBoundary 防单组件拖垮全树 |
| 附 | 接真实 VLM | ✅ 完成 | ClaudeVLMBackend 看图+NL→受约束 tool-use 三态；后端 /intent/backends + 密钥（env 或 UI 填入）；智能体面板配置弹层；不可用显式报错不静默 |
| 附 | 多模态抽象 + 胎儿头围(HC) | ✅ 完成 | 内核从单一 IMT 抽象成任务族（TaskDef 注册表 · 几何族 · 度量口径）；新增第二模态胎儿头围（闭合椭圆几何 · Ramanujan 周长）；合成数据 + 真椭圆检测（vs 真值 |bias| 0.80mm）；意图路由/驱动/后端/前端全读注册表分派；前端模态切换 + HC 画布/测量/智能体卡；IMT 路径回归无损 |
| M2– | F11–F18 | ⏳ 待办 | 下一步：F11 修正回流记忆层 / F13 Models 重跑 / F18 桌面壳 |

**M0 验证**（2026-07-06）：`uv run pytest` 9/9；前端 `npm run build` 59 模块通过、`lint`/`typecheck` 净；
`make dev` 两端起，Vite `/api` 反代联通，三态守卫经 `/interpret` 端到端可见（in_scope 带 spec、
out_of_scope 无 spec 拒绝），`/image` 返回真实 PNG 魔数。

**M1 验证**（2026-07-06）：后端 `pytest` 12/12（真实数据，主进程 `find_spec("tensorflow") is None`）；
前端 `typecheck`/`lint`/`build` 全绿；端到端 smoke（经 /api 反代）：/images 100 图带真实 CF、
/image 真 637×400 灰度 PNG、/segment caroSegDeep 636 真实点（缓存）、/run 真实测量
（tech_437：caroSegDeep PDM 1.19mm vs Manual-A1 1.31mm → |bias| 128µm）。
**浏览器实测**：真 B-mode + LI/MA 叠加渲染、Measurements 落真值、Agent 四步提议卡显真实 IMT。

## 变更记录
- **2026-07-06**：v1。由[前端设计稿](../designs/2026-07-06-glaux-ide-frontend.zh-CN.md) R1–R14 拆出
  F1–F18 实现单元，定 P0/P1/P2 与 M0–M4 里程碑排序；关键路径 = 真数据最小闭环 + 协同修正。
- **2026-07-06**：M0（F1–F4）落地并验证——脚手架 + 八区外壳 + i18n + 后端 mock 契约全绿。
- **2026-07-06**：M1（F5–F9）落地并验证——真数据最小闭环成立（demo 成立线）：真图 + caroSegDeep
  真实边界（缓存 + 隔离子进程）+ 对齐口径测量 + 三态守卫四步跑批；主进程仍无 TF。
- **2026-07-07**：多模态抽象 + 第二模态胎儿头围（HC）落地并验证。内核抽象为任务族
  （orchestration `TaskDef` 注册表：几何族 / 度量口径 / 信号词 / 标签），上层意图路由、
  `run_spec` 驱动、后端端点、前端画布/测量/智能体全部**读注册表分派**，不再硬编码 IMT。
  新增闭合轮廓几何（`io/contour.py` 椭圆 + Halir–Flusser 拟合）、HC 测量（`measurement/hc.py`
  Ramanujan 周长 + BPD/OFD）、真像素亮环椭圆检测器。HC 无外部数据集/模型故用合成图
  （真值椭圆栅格化，明标 synthetic），下游全真几何；10 图检测 vs 真值 |bias| 0.61–0.80mm。
  测试：science-core 83、orchestration 16、backend 19（+7 HC）全绿；前端 tsc + build 净；
  浏览器实测两模态端到端、模态切换双向、颈动脉 IMT 回归无损。保持 `glaux_imt` 包名（兼容）。
