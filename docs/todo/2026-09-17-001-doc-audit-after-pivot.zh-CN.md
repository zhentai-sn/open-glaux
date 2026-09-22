---
kind: record
status: open
---

# 战略转向后文档摸排

> 日期：2026-09-17 · 依据：纲领 v2（docs/roadmaps/charter.zh-CN.md）与 README 重写 · 范围：仓库内 80 份文档（不含本次已重写的纲领、README、chat-distribution 手册）

## 结论

- 建议删除 1 · 标注已被取代（正文不改） 10 · 需要修正 31 · 保持历史原样 33 · 仍然准确 5
- 删除建议都经过反方核查，推翻了 3 条中的 2 条。
- 落地页 docs/landing 是产品发布后的门户首页，保留并按纲领更新内容。

## 跨文档的共性问题

- 旧"环境四层 表征/动作/验证/记忆"与比喻：architecture、requirements、产品路线图、science-core/README、datasource-registry runbook，以及代码注释（science-core/glaux_core/__init__.py、backend/app/kernel.py 的 capabilities() layer 字段、schemas.py、routers/api.py、frontend SideBar/types.ts）。
- 旧纲领章节号：产品路线图"纲领 §六"（现 §七）、需求清单与 07-05 计划"纲领 §七"（现 §三）、前端质量路线图"第六条决策过滤器"与已删除的"复用优先"。
- 纲领自身"依据"一节仍链接产品路线图和竞品分析 §9，两者都建议标已取代，需要决定这一节改写还是删除。
- orchestration 退役残留：SDD 00 边界图、frontend-design-charter（M3、G5）、p7 runbook 的 PYTHONPATH、07 月计划的代码路径。
- 状态字段漂移：07-05/07-09/07-10 计划仍 active，atlas 与统一标注工具箱计划仍 draft，双模式外壳设计仍 reviewed；docs/README.md 与 sdd/README.md 各有一份 SDD 状态表，前者已过期。
- 活文档里夹带变更记录：frontend-design-charter、agent-connection、p6、p7 runbook，与"活文档不写变更简史"的约定冲突。
- 非文档但同类：agent-runtime 系统提示词仍写 biomedical（harness-registry.ts、vision.ts、consult-atlas.ts）；science-core/pyproject.toml description 仍是"首个楔子 CUBS IMT"；backend/app/datasource_registry.py 第 9 行 docstring 写 GLAUX_DEV_MODE=1 为缺省，实际缺省 0。

## 建议删除（1）

| 文档 | 说明 |
| --- | --- |
| `docs/plans/2026-08-26-release-blocker-fixes-plan.md` | 反方核查支持删除：无入链，内容是设计文档的逐项展开。 |

## 标注已被取代（正文不改）（10）

| 文档 | 说明 |
| --- | --- |
| `docs/requirements.zh-CN.md` | 2026-07-05 的 v0 需求清单，自称活文档，但全文建立在已废弃的前提上：生物医学定位、首用户 B、超声楔子、按旧环境四层（眼/手）编排、Tauri 桌面壳、引用纲领 §七 边界。逐条修正等于重写。它是早期决策的留痕，仍被 SDD 01 双模式外壳 §背景和多份历史文档引用，建议改为历史文档并标 superseded。 取代者：docs/roadmaps/charter.zh-CN.md |
| `docs/roadmaps/20260705-product-roadmap.zh-CN.md` | 首版产品路线图，仍自标“当前（current）”。北极星、生物医学影像 agent-native 环境、引擎两者兼有、旧环境四层与眼/手/律法/记忆、护城河判据“详见纲领 §六”、辅助决策远期北极星，均已被纲领 v2 删除或改写。按 roadmaps 按日期存档的约定，应保留留痕、只改状态；它仍被纲领“依据”节和 SDD 00 引用。 取代者：docs/roadmaps/charter.zh-CN.md |
| `docs/researches/20260705-01-market-competitive-landscape.zh-CN.md` | 2026-07-05 的竞品格局与定位分析。竞品清单和监控信号有留痕价值，但定位和 §9 护城河论述已被纲领 v2 取代。纲领「依据」一节仍把它的 §9 列为依据，所以不能删；建议加 superseded 标注，指向纲领 §五～§七。 取代者：docs/roadmaps/charter.zh-CN.md |
| `docs/researches/20260816-02-tech-deepseek-harness-integration.zh-CN.md` | 反方核查不支持删除：MCP server 暴露方案、原子工具切分原则、不替换 pi-agent-core 的理由别处没有。文首标已取代，并改 docs/README.md:69 与 brainstorms/README.md:44 两处索引状态。 |
| `docs/designs/2026-07-06-glaux-ide-frontend.zh-CN.md` | 2026-07-06 IDE 式前端的交接规范（CUBS IMT 标注器）。IDE 作为唯一或默认界面、Agent 栏走意图守卫、后端契约写 FastAPI → orchestration、修正回流「记忆层」，这些已分别被双模式外壳设计、前端设计纲领和 orchestration 退役取代；Workbench 布局和 token 的出处有留痕价值。 |
| `docs/designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md` | 多模态多任务架构设计（统一信封、TaskPlugin、Viewer 接缝、Capability 能力模型）。其中信封、注册表、Viewer 接缝已经落地（现为 glaux_core.tasks.REGISTRY，另有 VolumeViewer、WsiViewer），仍被 P6/P7 和 SDD 00 引用；但注册表位置（orchestration/spec.py）和按旧纲领「环境四层」划分的 Capability 模型已过期，留痕价值高，不宜删除。 |
| `docs/plans/2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md` | 首个楔子 CUBS IMT 的实现计划，U1–U8 内核和 U9 编排都已落地；但 frontmatter 还写着 status: active，正文的立论依据（环境四层、护城河在环境、旧纲领章节号、orchestration Phase B）都已被新纲领和 orchestration 退役取代。science-core 仍把它当作来源计划引用，有留痕价值，所以不删、不改正文，只加 superseded 标注。 |
| `docs/plans/2026-07-06-001-feat-glaux-ide-frontend-plan.zh-CN.md` | Glaux IDE 前端（FastAPI + React）F1–F18 的计划，内含 M0/M1 与 HC 真数据验证的进度记录（MAE 1.13mm 等，别处没有）。它依赖的 orchestration 意图层与 rule/VLM 二选一已退役，外壳后来由 dockview、双模式外壳、explorer 等计划接手；表中 F11–F18 仍标“待办”，容易被误读为现行待办。 |
| `docs/plans/2026-07-14-001-feat-agent-connection-config-plan.md` | 智能体连接配置（自定义端点、连接测试、模型列表、SSRF）的计划。它对应的 SDD 已标 superseded（被 2026-08-16 retire-orchestration 取代），P1–P3 放在 orchestration/intent.py 和 backend 里的实现已迁到 agent-runtime，rule/VLM 意图后端也已退役。runbook 已写明迁移，但计划本身没有标注。 取代者：docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md |
| `docs/sdd/feats/01-dual-mode-shell/mockup.html` | 2026-08-13 评审通过的 v1 交互设计稿；布局已被 v1.1–v1.4（右侧栏、舞台常驻分栏）取代，文案仍是旧定位'把任意模态的生物医学图像,变成可验证、可复现的洞察'，但作为评审留痕仍被 SDD 01 与设计文档引用。 |

## 需要修正（31）

### P1 · 入口与现行依据（9）

#### `docs/landing/index.html`

- 产品发布后的门户首页，整页仍是旧定位：生物医学影像洞察、"模型越强环境越值钱"、旧环境四层与眼/手/裁判/记忆插画、辅助决策远期。
- **全文**：按纲领 v2 重写宗旨、领域（图像与视频）、边界、harness 身份与环境四要素，删掉比喻插画的用法（judge.png、memory.png 只对应旧比喻）。
- **GitHub 链接**：写成 pre-tech/open-glaux → 改为 zhentai-sn/open-glaux。
- **页脚**：链向已过期的产品路线图 → 改指纲领。
- **演示数据**：0.82 mm、Dice 0.94 是示意值 → 发布前换成真实结果或标明示意。
- **assets**：ultrasound、ct、wsi、hand、eye 五张图同时是 SDD 02 sam3 实测的输入，保留。

#### `docs/README.md`

- 文档区导航与命名规约，属活文档。命名规约仍然有效，但 SDD 表、路线图状态、纲领和需求清单的描述都停在 8 月中旬及纲领 v1 的状态。
- **§核心文档·纲领条目**：纲领 v2 已删除北极星和发展目标，现在共七节：名字与宗旨、领域、边界、核心信念、身份、环境四要素、决策过滤器 → 改为：名字与宗旨、领域（图像与视频）、边界、核心信念、身份（harness）、环境四要素、决策过滤器
- **§核心文档·需求清单条目**：旧“环境四层”已删除。v0 需求以生物医学首用户 B 和超声楔子为前提，已不是活文档（本组建议给它标 superseded） → 改为：2026-07-05 首版需求（历史，已被纲领 v2 取代），或移出“核心文档”
- **§二 现有路线图表**：产品路线图的北极星、旧四层和引擎两者兼有都已废弃，不能再标“当前”。前端路线图 P0～P2 已落地；“纲领”容易被误读为产品纲领，实际指前端设计纲领 → 产品路线图状态改为 superseded（被纲领 v2 取代，新版路线图待立）；前端路线图改为“P0–P2 已落地，P3 待办（落地前端设计纲领）”
- **§四 规范驱动开发 sdd/ 表**：与 sdd/README.md 和各 Feature 实际状态不符：01 是 implemented v1.4，02 和 04 是 implemented，03 是 v1.2；缺 05–09 和公共规范 01 → 删掉这张重复表，只留一句“索引与状态见 sdd/README.md”，避免双份事实源漂移
- **§当前发行工作**：SDD 09 已 implemented，当前真相应以 SDD 和 runbook 为准，不应指向带日期的 plan → 改为指向 sdd/feats/09-chat-distribution/README.md 和 runbooks/chat-distribution.md（安装、运行与分发手册）
- **§目录结构树**：docs/landing/ 未登记 → 补一行 `landing/`，说明是产品门户首页

#### `docs/architecture.zh-CN.md`

- 仓库骨架总览活文档，被中英 README 作为“架构说明”链接。运行时三进程和三条不变量仍然成立，但文件树、组件定位和工具清单停在 2026-08-16，没有反映 9-17 的目录迁移、Docker 发行包、版本治理和新纲领。
- **frontmatter updated / 正文“日期”**：之后有版本治理、发行包、脚本和 Dockerfile 迁移等结构变化，均未同步 → 修订后更新日期
- **§仓库文件树·根目录**：缺 VERSION、CHANGELOG.md、compose.yaml（chat 版发行 compose）、docker/（Dockerfile、compose.build.yaml、nginx.conf）、dist/（发行产物，gitignore） → 补上这些条目，注明 docker/ 为发行包镜像构建、compose.yaml 为对话预览版（chat edition）部署
- **§仓库文件树 scripts/ 与 §scripts/ — 归档开发脚本**：scripts/ 已重组：scripts/dev/ 放 run-backend.sh、restart-backend.sh、run-agent-runtime.sh、health.sh 和历史 glaux_* 脚本；scripts/release/ 放 package.py 和 launcher/start|stop；根下另有 version_matrix.py（版本检查） → 改为三行：scripts/dev（开发启动/健康检查 + 归档一次性脚本）、scripts/release（发行打包与启停 launcher）、version_matrix.py（SDD 01 版本矩阵检查）
- **§仓库文件树 science-core/ 与 §science-core 小节首句**：纲领 v2 已删除旧环境四层，改为观测空间、动作空间、验证器、回合与轨迹 → 改为“无头科学内核：观测、动作、验证等要素的纯计算实现 + 任务注册表”，或直接去掉四层括注
- **§运行时全景首句 / 图**：只描述开发形态，缺 Docker 发行包（chat edition：agent + web/nginx，无 backend）和 edition 区分（本地开发缺省 full，含舞台、图谱） → 加一小段“部署形态”：本地开发 = full 三进程；Docker 发行包 = chat edition（agent-runtime + nginx 静态前端），指向 SDD 09 和 runbooks/chat-distribution.md
- **§frontend 小节首句 / 文件树 frontend 注释**：“生物医学影像”定位已废弃，领域现为图像与视频；前端已有 Focus 对话优先形态和 edition 开关（src/edition.ts） → 改为“图像与视频分析前端：Focus（对话优先）/ Workbench（IDE）双模式，按 edition 裁剪（chat / full）”
- **§agent-runtime 表·工具行**：工具实际还有 view_image、propose_annotation、segment_region、locate_roi、consult_atlas（agent-runtime/src/pi/tools/） → 列出全部工具，并注明 run_task 是 SDD 02 之前的过渡工具
- **§仓库文件树 data/ 与 §data 表**：data/ 下还有 natural/（SDD 07 自然图像示例） → 补 natural/ 行
- **§docs 树**：与 docs/README.md 应保持一致 → 随 docs/README 同步

#### `docs/designs/frontend-design-charter.zh-CN.md`

- 前端视觉交互设计纲领，status: living，被 SDD 01/05/06 与前端质量路线图当作评审依据。原则层大体仍有效，但有几处说法与代码现状（意图层已退役、动效 token 已落地、tokens.css 注释、发行版本区分）及新纲领的领域范围不符。
- **§5 M3「过程感即信任感」**：Interpret 这一步对应 orchestration 意图解析，2026-08-16 已退役；现在智能体的过程由 agent-runtime 会话里的推理和工具调用组成，不再有固定四步 → 改成「工具调用逐项呈现进行中与完成状态」，不再写死四步名称
- **§2 G5 三态守卫**：「歧义追问 / 超范围拒绝」原本由意图层 IntentResult/Scope 实现，该层已删除，现在由智能体推理和工具返回的错误承担，文中没有交代来源 → 保留三态语义，把来源改成「智能体澄清或工具显式拒绝（如缺标定）」，不再暗示有独立的意图闸门
- **§5 末尾「动效 token(共享层)」**：frontend/src/styles/tokens.css 第 75-80 行已经定义了 --motion-fast/base/slow 和 --ease-*，这条待办已完成 → 删掉这句，改为「真相源：tokens.css」
- **§6 末尾遗留待办**：tokens.css 里 --accent 已是蓝色 #0e70c0，只有 --status 还是紫色 #6a3fb0，注释与值对不上，纲领沿用了过期的注释说法 → 改为「--status 仍是临时紫色，与 --agent 同系，待主题 SDD 处理」；另开一项改正 tokens.css 的注释（不在本文档范围）
- **§2 G1「双模式恒定」**：Docker 发行包是对话预览版（VITE_GLAUX_EDITION=chat），隐藏模式切换并锁定 Focus（见 frontend/src/chatEdition.test.tsx）；本地开发缺省是完整版 full。G1 没有区分发行版本 → 补一句：对话预览版只保留 Focus、不出现模式切换；完整版保持双模式、默认 Focus
- **§3 G11 深色冷调的理由**：纲领 v2 把领域扩大到自然图像与视频、显微与病理、医学影像，只用医学影像审读来论证过窄 → 改成「影像审读（医学影像、显微、视频）在低眩光底色下动态范围与叠加对比最好」
- **文末「变更记录」一节**：违反活文档不写变更简史的约定，变化看 git diff → 删除整节

#### `docs/plans/2026-09-06-chat-distribution-design.md`

- 基本对话发行包的设计与实施记录，docs/README.md 把它列为入口文档，因此仍会被当作现行依据。但 2026-09-17 的提交 0d24b65 已把缺省版本改为 full，chat 只由 Docker 发行包显式设置，本文“chat 为默认”与现状冲突；SDD 09 与 runbook 已同步，本文未同步。
- **第 5 行（开篇方案段）**：缺省已改为 full（frontend/src/edition.ts、agent-runtime/src/edition.ts；SDD 09 写作“full（默认，含舞台与图谱）或 chat（Docker 发行包显式设置）”），full 也不再是“实验入口” → 改为：采用 chat/full 发行模式：本地开发缺省为 full（含舞台、图谱），Docker 发行包显式设置为 chat。
- **实施顺序第 1 条、自审段末尾**：脚本已移到 scripts/dev/run-agent-runtime.sh，根目录路径已不存在 → 属于当时的执行记录，可保留；如需一致可改写为 `scripts/dev/run-agent-runtime.sh`（原位于根目录）

#### `docs/sdd/feats/09-chat-distribution/README.md`

- 基本对话 Docker 发行包 SDD。提交 0d24b65 把 edition 缺省改为 full，但只改了 §9，§7 首条规则仍写默认 chat，文档前后矛盾。
- **§7 核心规则第 1 条**：与 §9 以及代码矛盾：frontend/src/edition.ts 和 agent-runtime/src/edition.ts 缺省为 full，chat 只由 docker/Dockerfile 和 compose.yaml 显式设置 → 改为：缺省 full（含舞台与图谱）；Docker 发行包显式设 chat
- **§0 文档状态**：2026-09-17 改过缺省版本，日期没更新 → 更新为 2026-09-17
- **§16 决策记录**：没有记录缺省版本从 chat 改为 full 的决策 → 补一条 D4：本地开发缺省 full，发行包显式 chat（2026-09-17）

#### `backend/README.md`

- backend 组件的活文档（端点表 + 运行/测试），2026-08-16 退役 orchestration 后更新过。但端点表缺少后来加的路由，标题和开头还在用旧叫法。
- **第 1 行标题**：纲领 v2 定位是 harness（智能体 = harness + 模型），不再用 IDE 定位；README 已重写，不再用这个叫法 → 改为「# backend · Glaux 的 FastAPI 服务」，或写明它是 harness 的数据与计算服务
- **第 3 行**：「§5 契约」没有说明出处（原指早期计划文档的章节），对照现行文档无法定位 → 删掉「§5 契约」，改为「把 HTTP 端点接到 science-core 内核与各隔离模型子进程（caroSegDeep、HC、TotalSegmentator、StarDist 等）」
- **第 6 行 / 第 20 行设计文档链接**：实际文件名带 .zh-CN.md 后缀，现在的写法不能点击跳转 → 改成 Markdown 链接，指向 ../docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md
- **第 8-21 行端点表**：代码里现有、表里没有的路由：GET /health；POST /datasources/samples；POST /uploads/images（SDD 08）；/atlas/* 整组（annotations、exemplars、exemplars/search、exemplars/referenced、collections、tags、imports/pdf、imports/url 等，SDD 03 Atlas）。表头「只保留前端 / agent-runtime 实际调用的」已经不能代表全部路由 → 补上 /health、/datasources/samples、/uploads/images 三行；Atlas 加一行汇总「/atlas/*（标注、案例库、导入）→ 见 SDD 03」；小标题去掉「2026-08-16 清理后」这个日期限定

#### `science-core/README.md`

- science-core 包的入口 README，仍停留在只做 CUBS IMT 的阶段：包名、定位、四层说法都过期了。安装、数据、边界约束几节仍然有效。
- **第 1 行标题**：pyproject 里的包名早已是 glaux-core（导入名 glaux_core）；tasks.REGISTRY 覆盖 carotid_imt、fetal_hc、ct_abdomen、pathology 四个模态，不止 IMT → 改为「# glaux-core · Glaux 科学内核」
- **第 3-5 行**：纲领 v2 已删除「环境四层」，改为环境四要素（观测空间、动作空间、验证器、回合与轨迹）；「首个楔子」是早期阶段的叫法 → 改为：headless 科学内核，提供任务注册表 glaux_core.tasks.REGISTRY（能力清单单一事实源）以及各模态的读取、标定、分割/检测、测量、验证。CUBS IMT 是第一个实现的任务，流程为 读取→标定→表征→分割→PDM 测量→验证→结构化产物→评测。删掉四层的说法，需要的话改用纲领 §六 的四要素术语
- **第 7-8 行计划/需求链接**：都是历史文档，只对应 IMT 首任务，不代表现状 → 保留，但标为「IMT 首任务的历史计划 / 需求」；现状指向 docs/architecture.zh-CN.md
- **第 40-43 行边界约束**：与纲领 §三 一致，但没有写「到可计算表征为止，决策由用户自建」 → 可以补一句「输出止于可计算表征，决策由用户自建（纲领 §三）」

#### `scripts/dev/README.md`

- 原本是 P4-P7 一次性调试脚本的归档说明。2026-09-17 把 run-backend.sh 等四个联调脚本移进来后补了「本地联调脚本」一节，但开头的定性还是「归档 / 不是运行时依赖 / 仅作历史留痕」，与这些脚本仍在使用的事实矛盾。
- **第 1 行标题与第 3-7 行警示块**：目录里现在有两类脚本：归档的一次性脚本（glaux_*.sh、eval_carosegdeep.py）和在用的本地联调脚本（run-backend.sh、restart-backend.sh、run-agent-runtime.sh、health.sh）。整目录标成归档，会让人误以为联调脚本也已作废 → 标题改为「# scripts/dev — 本地开发脚本」；开头分两句说明：联调脚本在用，其余 glaux_* 脚本是历史归档；警示块只针对归档那一节
- **第 9 行**：只说了归档脚本的来历，没说联调脚本是 2026-09-17 从仓库根目录移进来的 → 在「本地联调脚本」一节加一句「2026-09-17 由仓库根目录移入」，或者不写日期，只说明用途
- **第 32-35 行联调脚本表**：基本准确，但漏了一点：run-backend.sh 缺省 GLAUX_DEV_MODE=1（SDD 08 翻转缺省之后） → run-backend.sh 的说明补上「缺省 GLAUX_DEV_MODE=1，打开内置示例源」

### P2 · SDD、设计与索引的交叉漂移（12）

#### `docs/roadmaps/20260818-frontend-quality-roadmap.zh-CN.md`

- 前端打磨层执行路线，落地的是前端设计纲领（designs/frontend-design-charter），与产品纲领无关，内容基本准确，P3 仍待办。只有两处引用了产品纲领已删除的概念和旧章节号；另外 frontmatter 状态没有反映 P0～P2 已落地。
- **§3 设计资产策略首句（约第 90 行）**：“两条纪律（环境要深、复用优先）”已从纲领 v2 删除 → 改为“依产品纲领 §七 决策过滤器”，删去“复用优先”引语，或改写为“结构层无差异化，按决策过滤器属负债，复用成熟资产”
- **§3 末“一句话”（约第 106 行）**：决策过滤器现为纲领 §七 → 改为“产品纲领 §七 决策过滤器”
- **frontmatter status / 变更记录**：落地进度已写明 P0、P1、P2 和图标系统完成，仅剩 P3 与 Radix/React Aria → status 保持为执行中，或按项目习惯改为 implemented（P3 待办）；变更记录补 2026-08-19 P2 与 SDD 06
- **§P1-2（第 67 行）**：“B 类用户”出自已被取代的需求清单 → 改为“非技术用户”（可选，低优先级）

#### `docs/sdd/01-version-release-governance.md`

- 多组件版本与发布治理规范，契约（事实源、标签、CHANGELOG、version_matrix.py）与代码一致。状态描述停在首发之前：v0.1.0 标签已存在，CHANGELOG 已记录 0.2.0（2026-08-31），五个事实源均为 0.2.0。改动很小，不影响契约。
- **§0 文档状态·当前阶段 / 最后更新**：已打出 v0.1.0 标签并发布 0.2.0（CHANGELOG），“待首次正式发布”不再成立；可评估是否进入 accepted → 改为“已完成 v0.1.0、0.2.0 发布”，由维护者决定是否升为 accepted，并同步 sdd/README 索引
- **§3 当前阶段目标 / §15 验收“输出五项均为 0.1.0”**：这是当时的阶段目标，现值为 0.2.0，读者可能误以为当前版本是 0.1.0（§9 已写明是“初始值”，没有问题） → §3 改为“首个基线版本定为 0.1.0”；§15 为验收记录，可保持原样
- **§14 与其他 SDD 的调用关系**：SDD 09 发行包使用 0.2.0-chat.1 预发布后缀的镜像版本，与本规范的 R3 相关，但没有互链 → 加一行：SDD 09 发行镜像版本号遵循 R3 预发布后缀，链接 feats/09-chat-distribution

#### `docs/brainstorms/README.md`

- 脑暴索引是活文档（带状态跟踪表），但表里记的 SDD 状态停在 2026-08-16，和各 SDD 现状对不上。
- **需求跟踪表 20260816-01-agent-browser-capability 行「去向」**：SDD 02 已是 `implemented`（2026-08-26 更新） → 改为 → SDD 02 `implemented`；分支 B 待评审
- **需求跟踪表 20260816-02-unified-annotation-toolbox 行「去向」**：SDD 04 已是 `implemented` → 改为 → SDD 04 `implemented`
- **调研阶段需求表 20260816-01-tech-annotation-exemplar-store 行**：SDD 03 已是 `implemented`（v1.2，待维护者验收） → 改为 → SDD 03 Atlas `implemented`
- **调研阶段需求表 20260816-02-tech-deepseek-harness-integration 行**：该调研前提已被纲领 v2 §五 推翻，建议删除 → 删除该文档后同步删掉这一行；如果保留文档，就把状态改为「已被纲领 v2 取代，不推进」

#### `docs/brainstorms/20260816-01-agent-browser-capability.zh-CN.md`

- 状态仍是 `review`（分支 B 未决），属活文档。分支 A 的落地状态、分割后端描述已过期，分支 B「无真实场景」的判断也没反映出图谱网页导入已落地。
- **文首状态、§1 末句、§5 流程图 A3 节点、§5.1、变更记录**：SDD 02 已是 `implemented`，§17 已于 2026-08-22 收敛 → 改为 SDD 02 `implemented`，删掉「待 §17 收敛后转 ready」
- **§5.1**：SDD 02 §17 已选定 Gitee AI（模力方舟）`sam3` 作为分割后端并实测 → 改为「分割走 SDD 02 选定的托管 sam3（Gitee AI），见 SDD 02 §17」
- **§3 第 1 条**：agent-runtime/src/pi/harness-registry.ts 已注册 locate_roi / segment_region / consult_atlas 等工具，不再只有过渡工具 → 改为「工具注册在 agent-runtime harness-registry，run_task 为过渡工具，分支 A 工具已登记」
- **§3 第 4 条**：这一方向出自 2026-07-05 旧路线图；纲领 v2 §五 定 Glaux 为 harness、模型用户自带，「被外部 agent 调用」不再是现行方向 → 删掉这条，或改为「旧路线图曾列 MCP server 方向，纲领 v2 未保留」
- **§5.2、§6 开放问题 1**：SDD 03 图谱已实现从网页 URL 导入（backend/app/routers/atlas.py `/imports/url`，带出站守卫），是由 backend 直接抓取，不走浏览器自动化 → 补一句：外部网页读取已有一个具体落地（图谱 URL 导入，服务端抓取、不需要浏览器自动化），分支 B 仍只指需要交互操作的第三方页面

#### `docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md`

- 退役 orchestration 的设计，P1–P3 已落地（orchestration/ 目录已不存在，REGISTRY 在 science-core/glaux_core/tasks.py），是三条架构不变量的出处，仍是当前依据。正文作为落地记录保持原样，只需修正对纲领的引用和状态字段。
- **文首引用块「依据」**：「agent 是引擎」那一节已从纲领删除；纲领 v2 §五 的说法是智能体 = harness + 模型，Glaux 是 harness → 改为「[纲领 §五](../roadmaps/charter.zh-CN.md)（智能体 = harness + 模型，Glaux 是 harness）」
- **§0「目标不变量（本设计新增，进入纲领级约束）」**：纲领 v2 共七节，没有收录这三条不变量，读者去纲领里找不到 → 改为「本设计确立的架构不变量（记录于 architecture.zh-CN.md）」，或者确实写进 architecture 文档后再指向那里
- **frontmatter status 与引用块「状态」**：orchestration/ 已删除，意图端点已退役一个月；如果已经验收，应改为 accepted，否则会长期挂着「待验收」 → 由维护者确认后改成 accepted，或写明验收还差什么

#### `docs/sdd/feats/00-reference-agent-conversations/README.md`

- 参考智能体会话 SDD（implemented），契约与代码基本一致，但第一阶段的边界描述、系统边界图仍保留 orchestration 与'无工具/附件禁用'等已被后续 SDD 与 2026-08-16 退役改掉的说法。
- **§6.1 系统边界 mermaid，CORE 节点**：orchestration/ 意图层 2026-08-16 已退役，现架构为 agent-runtime 经 run_task 调 backend /task/run，science-core 只含 glaux_core。 → 节点改为 "science-core（glaux_core.tasks.REGISTRY）"；领域工具虚线注明 run_task → /task/run。
- **§6.1 列表末条**：'任务编排'指已退役的 orchestration；且 SDD 02/03 已把领域工具接入调用链。 → 改为'第一阶段 Python FastAPI 与 science-core 不在调用链中；领域工具接入见 SDD 02（run_task、locate_roi 等）'。
- **§6.4 会话侧栏交互第 4 项**：与同文 D-021（2026-08-19 已支持粘贴/选择/拖放图像附件）直接矛盾。 → 改为'输入区：多行文本、图像附件（粘贴/选择/拖放，见 §4.3 与 D-021）、发送/停止'。
- **§7 规则 15**：SDD 02 已在 beforeToolCall 与工具注册期让 permission_mode 生效（observe 返回空工具集）。 → 补一句'工具门控语义由 SDD 02 §7.3 定义'，或删去'不执行工具'。
- **§2 非目标首条、§17 开放问题**：作为阶段非目标可保留，但未指明已由 SDD 02/03 接管，读者易误以为现状仍无工具。 → 在该条后加'（已由 SDD 02、03 承接）'，去掉'任务编排'字样。

#### `docs/sdd/feats/01-dual-mode-shell/README.md`

- 双模式外壳 SDD（v1.4 implemented），v1.4 修订已追加但前文若干处仍按 v1.1 三标签形态、'参考智能体未接领域工具'描述，另有章节内引用错位。
- **§5.1 用户可见输出第一条**：v1.4（D16/D19）已改为舞台常驻 + 文件/图谱两枚开关式浏览器列。 → 改为'右侧栏(可折叠;舞台常驻,文件/图谱为贴右缘的浏览器列,二者互斥可关闭;v1.4,D16–D19)'。
- **§7 规则 4 度量呈现**：run_task、locate_roi、segment_region、propose_annotation、consult_atlas 均已在 agent-runtime 注册，会话内已产生任务运行。 → 改写为现状：run_task 结果经 toolBridge 写回查看器；对话内 taskrun 卡片是否已落地按代码核实后写明。
- **§0 进入 ready 的依据**：动效规则现为 §7 第 8 条（第 7 条是栏宽可调）。 → 改为'见本文 §7 第 8 条'。
- **§3 背景**：需求清单是 2026-07-05 v0 文档（按旧'环境四层'编排），纲领 v2 未再以'首要用户 B'定位；作为活依据需确认。 → 若需求清单被判过期，改为引用纲领/前端设计纲领 G1–G2，保留'对话优先'表述，去掉'首要用户 B'作为现行依据。
- **§16 D12 理由**：纲领 v2 已删除'两条纪律（环境要深、复用优先）'，该引用无处可查。 → 决策记录可不改正文，或改为'复用优先(工程取向)'去掉 charter 指向。

#### `docs/sdd/feats/02-agent-image-annotation/README.md`

- 智能体标注 SDD（implemented），工具、门控、代码路径与 agent-runtime 现状一致；仅 run_task 去留自相矛盾及个别旧边界措辞需修。
- **§7.1 工具注册段**：与 §7.2 第 1 条'校准测量恒走 run_task'矛盾；实现中 run_task 与三个标注工具并存（agent-runtime/src/pi/tools/run-task.ts），系统提示也让模型'run_task for calibrated measurements'。 → 改为'run_task 保留，承担 science-core 校准测量（§7.2 第 1 条）；是否退役另议'。
- **§16 D-4 理由**：边界现以纲领 §三表述：生物医学方向只做研究、不做临床诊断；'研究洞察'是旧定位用语。 → 决策记录可保留原文；如修，改为'纲领 §三：只做研究、不做临床诊断'。

#### `docs/sdd/feats/03-atlas/README.md`

- Atlas 图谱 SDD（implemented v1.2），后端/工具契约与代码一致；但 Focus 布局字段仍按 SDD 01 v1.1 的 rightView 描述，另含旧路线图'主线楔子'概念与外发门控表述和 02 不一致。
- **§9 末段'前端状态'**：SDD 01 v1.4 已用 browserView: "files"|"atlas"|null 取代 rightView（frontend FocusSidePanel.tsx 读 browserView）。 → 改为'`FocusLayout.browserView = "atlas"`（SDD 01 v1.4 §9）；「在图谱中打开」设置 {rightOpen:true, browserView:"atlas"}'。
- **§8 涉及对象'Atlas 页面（Focus）'行 与 §14 依赖 01 条**：现为 Focus 右侧栏中与常驻舞台并排的浏览器列；§14 只写 Workbench 不全。 → 改为'Workbench 左侧侧栏视图；Focus 右侧栏浏览器列（SDD 01 v1.4）'。
- **§2 非目标末条 与 §16 D-12**：'楔子'来自 2026-07-05 产品路线图的'愿景宽、楔子窄'，纲领 v2 已不再以单一楔子定位（领域为图像与视频多模态）。 → §2 改为'改变 science-core 既有任务（如颈动脉超声分割）'；D-12 决策记录可保留。
- **§7.4 外发规则首条**：02 §7.4 明确 locate_roi 发往用户自配模型连接不受该开关约束，实现以 egressFor(connection) 按回环与否决定 local-only 案例是否随行；两份 SDD 表述不一致。 → 改为'按 egressFor(connection) 判定：仅回环 base_url 可带 local-only 案例；GLAUX_ANNOT_ALLOW_EGRESS 只约束第三方分割服务（02 §7.4）'，并同步 §15 未勾选项。

#### `docs/sdd/feats/04-unified-annotation-toolbox/README.md`

- 统一标注工具箱 SDD（implemented），契约与代码路径仍有效；相关 SDD 状态标注停留在 2026-08-16，且引用了纲领已删除的'记忆层'和'复用优先'。
- **§14 与其他 SDD 的调用关系**：三者现均为 implemented（01 为 v1.4 implemented、v1 accepted）。 → 去掉括号内状态或改为指向 docs/sdd/README.md 索引，避免再次过期。
- **§2 表格首行**：02 已 implemented；02 状态词为 confirmed 而非 accept。 → 改为'（implemented）；其 suggested → confirmed 后即本 SDD 的 confirmed 实体'。
- **§2 表格末行**：纲领 v2 已删除'记忆层'（旧环境四层）；现用语为环境四要素中的回合与轨迹。 → 改为'标注与 Atlas 的联动（已验证标注沉淀为案例）'。
- **§16 D-12 理由**：纲领 v2 已删除'两条纪律'，引用无处可查。 → 决策记录可保留；如修，改为'复用成熟框架而非平行实现'，去掉纲领指向。

#### `docs/sdd/feats/05-keyboard-shortcuts-a11y/README.md`

- 快捷键与可达性 SDD，状态 implemented，是 globalKeys.ts 的现行契约。SDD 04 已合入，实际键位也已变化，但文中仍按 04 未就绪时的过渡形态来写；chat 版如何裁剪快捷键也没有记录。
- **§7 R3、§15 第 4 条验收**：实际工具键是 frontend/src/keys/globalKeys.ts 里的 TOOL_KEYS = V/R/P/W/B，L/M 已不存在 → 改为 V/R/P/W/B
- **§7.1 快捷键分组表**：缺少 W（壁线编辑，setTool('wall')），与 ALL_SHORTCUT_ROWS 不一致 → 补一行：工具 · 壁线编辑 | W | setTool('wall') | 查看器聚焦
- **§9 工具声明扩展、§14 依赖 SDD 04、§16 D-2**：SDD 04 已是 implemented，TOOL_KEYS 按 04 的统一工具集定稿，仍是前端常量，没有迁到工具声明上。'04 未实现' 和 '过渡' 的说法都已过期 → 改成现状：键位由 globalKeys.ts 的 TOOL_KEYS/SHORTCUT_ROWS 常量承载，与 04 工具集对齐；如果不再打算迁到工具声明，就在 D-2 里写明
- **§13 或 §14（缺失）**：chat 版下 SHORTCUT_ROWS 只保留 sc_left 和 sc_sheet，Esc 不再复位工具，模式切换键也不能进入工作台（SDD 09 §14 覆盖了本 SDD） → 加一条：chat 版只保留左会话栏与速查面板两个快捷键，其余由 SDD 09 覆盖；full 版保持本 SDD 原契约

#### `docs/sdd/feats/07-natural-image-sam-demo/README.md`

- 自然图像 SAM 演示 SDD，4 张图片的白名单、许可和取图安全边界仍然有效。SDD 08 要求同步修订本文，但只改了 §2 和 §7 规则 5，其余几处仍写着“文件栏常驻”，与 GLAUX_DEV_MODE 缺省为 0、示例需显式加载的现状冲突。
- **§3 当前阶段目标第 1 条**：SDD 08 规则 13 已取代：GLAUX_DEV_MODE=0（缺省）时，要显式加载示例数据才出现 → 改为：加载示例数据（或 GLAUX_DEV_MODE=1）后，文件栏展示 natural-images/ 和 4 张照片
- **§8 涉及对象 Frontend Explorer 行**：已不再常驻 → 改为：示例源或导入源激活时渲染自然图像目录与选择动作（可见性见 SDD 08）
- **§11 最后一条**：SDD 08 规定没有活动数据源时 Explorer 只渲染空态卡，不保留空目录 → 改为：没有活动数据源时，按 SDD 08 渲染空态
- **§15 验收第 5 条**：这条已被 SDD 08 废除，现在打勾会误导 → 加注“已由 SDD 08 §7 规则 13 取代”，或改写为“加载示例数据后显示”
- **§16 D-3**：决策已被 SDD 08 D-4 推翻，但没有标注 → 在该行末尾加“（已由 SDD 08 D-4 取代）”
- **§5.3 模态标签**：SDD 08 D-3 已把模态切换器标签改为“通用图像 / General images”（i18n mod_general_images）；FocusTopBar 仍用 natural_images 文案 → 注明：模态切换器标签按 SDD 08 D-3 为“通用图像”，顶栏等处是否统一另行确认

### P3 · 操作手册、数据说明与台账（10）

#### `docs/runbooks/agent-connection.md`

- 活 runbook，讲模型连接、连接测试、拉取模型和 SSRF 守卫。主体与代码一致（connection-probe.ts、net-guard.ts 都在 agent-runtime，fake-ip 段默认放行），只有少量过期或冗余的说法。
- **文首引用块第 7-8 行「更新记录：2026-08-16 —— 探测端点与 SSRF 守卫迁至 agent-runtime……」**：活文档里写了变更简史，违反「活文档不写变更简史」约定。正文里已经写明现状（端点在 agent-runtime）。 → 删掉「更新记录」这段，只保留「后端实现在 agent-runtime」这一句现状。
- **§三个通道 C 第 4 步**：run_task 是 SDD 02 之前的过渡工具。现在 runtime 已经有 locate_roi、segment_region、consult_atlas 等工具，而且对话预览版和 observe 权限模式下不挂任何工具（harness-registry.ts:84）。这里写成「只有 run_task」，也没说明版本和权限的前提。 → 改成「智能体调用已注册的领域工具（如 run_task / locate_roi）；需要完整版，且权限模式不是 observe」。
- **§已验证 第 2 条「2026-07-14（迁移前，历史）：Python 版 test_vlm_providers…」**：这是迁移前的历史验证记录，对现状没有参考价值。 → 删掉这一条，只保留迁移后的验证结果。

#### `docs/runbooks/atlas-import.md`

- 活 runbook，讲 Atlas 的三种导入方式、环境变量和检索/下架。核对过 backend net_guard 的 FAKEIP/HOST_ALLOW 与 /atlas 路由，内容基本准确；只有 locate_roi 已落地这一点没跟上。
- **§价值验证脚本 末段**：SDD 02 的 locate_roi 已经实现（agent-runtime/src/pi/tools/locate-roi.ts），「落地后复跑」这个条件已经满足。 → 改成「locate_roi 已实现，可直接复跑对比」；如果已有复跑结论，就写上结论。
- **§一句话**：没提现在的调用入口。agent 实际通过 consult_atlas 工具（SDD 03 D-21）和 locate_roi 内部检索来使用图谱。 → 补一句：agent 通过 `consult_atlas` 工具或 `locate_roi` 内部检索读取图谱，只能读不能写。
- **§进程与端口 frontend 行**：Docker 发行包是对话预览版，不包含图谱；文中没说明图谱只在完整版（full）里有。 → 注明「完整版（本地开发缺省）才有图谱入口，对话预览版不含」。

#### `docs/runbooks/datasource-registry.md`

- 活 runbook，讲 DataSource 注册表和开发者/产品模式。SDD 08 之后缺省值、内置源数量、导入入口和范围都变了，文档仍停在 2026-07-13 的状态，多处与代码冲突。
- **§两种模式 表头与 §关键路径/env 表 GLAUX_DEV_MODE 行**：SDD 08 D-4 已把缺省改为 0（datasource_registry.py:75），产品模式才是缺省；Makefile 的 backend 目标显式设了 GLAUX_DEV_MODE=1。 → 改成：缺省 0（产品模式）；`make dev` / scripts/dev 启动时显式设为 1；产品模式可用「加载示例数据」（POST /datasources/samples）按需注册示例源。
- **§一句话 与 §两种模式「内置源 4 个（CUBS/HC18/CT/WSI）」**：_builtin_specs 现在有 5 个源，多了 natural-demo（natural_image）。 → 改成 5 个，补上 Natural images · demo。
- **§一句话「数据表征层从 config 写死……」、§导入 A 第 2 步「表征层 下点」**：「表征层」出自旧的「环境四层」，纲领 v2 已删除。导入入口也已从插件市场移到统一导入面板（ImportPanel.tsx，SDD 08 §5.4）。 → 去掉「表征层」说法，直接写「数据源」；步骤改成统一导入面板的三个入口：上传本地图片、打开服务端文件夹、加载示例数据。
- **§导入 A 第 1 步与 §两种模式「前端标识 市场页…紫点/绿点」**：入口已经迁走，模式标识需要按现有 UI 重新核实。 → 按现有 ImportPanel / 侧栏重写 UI 步骤；模式标识如已删除就去掉这一行。
- **§范围（v0）「不做：浏览器上传（v0 是服务端可达路径）」**：浏览器上传已经实现（POST /uploads/images，只收 JPEG/PNG，≤32MB）。 → 改成「浏览器上传支持通用图像（jpeg/png，≤32MB）；医学模态（WSI/CT）仍走服务端文件夹导入」。
- **§验证（真机 e2e，2026-07-13）**：这是当时的一次性验证记录，测试数量已经过期（现在 backend 217+）。 → 删掉，或只保留一句「相关测试见 backend/tests/test_datasource*」。

#### `docs/runbooks/p6-3d-totalseg-wedge.md`

- 3D CT TotalSegmentator 的手动 e2e runbook。环境搭建、driver、env 这几步仍然有效（runner、segment_ts.labelmap_path、dice_per_class、LIVER_KIDNEY_CLASSES、mask-edit 路由都还在），但 UI 步骤、已知问题和展望停在 v0，和后来 v3 的修复及现状矛盾。
- **§8 第 1 步**：模态切换器现在按 /datasources 显示（SideBar）；默认产品模式下内置 CT 源不可见，需要 GLAUX_DEV_MODE=1 或先加载示例数据。 → 改成「侧栏模态切换器选 ct_abdomen（需开发者模式或先加载示例数据）」。
- **§8 第 7 步**：/volume/{id}/segment 已于 2026-08-16 删除，重跑走 POST /task/run。 → 改成「工具栏 Reset to model（重置为模型输出），内部重跑 /task/run」。
- **§9「画笔没显示（v0 简化）」与「U4 留接口，CS3D SegmentIndex 体素叠色 v0 不稳定」**：评审 todo v3 已记录分割叠色和画笔都已实装并在浏览器验证过，这条已知问题过期。 → 删掉这条。
- **§9「首跑 5-10 min」「CUDA」两条与 HOME 坑**：两条内容重复，需对照 segment_ts._run_live 当前 env 重新核实（包括 HOME 是否已补）。 → 合并成一条，按当前代码写。
- **§10 后续路径 与 §变更记录**：P7 已经落地；runbook 属于活文档，不应留展望和变更记录。 → 删掉 §10 和「变更记录」小节。
- **文首「半衰期：… CS3D 4.x→5.x」、§8 第 6 步「历史期望响应（原端点形状）」**：verify 端点已删除，保留旧 JSON 形状容易误导；脚本输出其实是 dice_per_class 的 dict。 → 换成脚本的实际输出示例，删掉旧端点的 JSON。

#### `docs/runbooks/p7-wsi-nuclei-wedge.md`

- WSI StarDist 核检测的手动 e2e runbook。环境、driver、/slides、/wsi tile、/wsi/{id}/verify 和 segment_wsi.segment 都还有效，data/wsi/README 也链接到它；需要修的是退役目录引用、UI 步骤和展望/变更记录。
- **§6 代码块第 1 行**：orchestration/ 已于 2026-08-16 退役，目录已不存在。 → 改成 PYTHONPATH=../science-core:.（或 uv run python，由 config 装配 sys.path）。
- **§8 第 1 步**：模态可见性现在取决于 /datasources；缺省是产品模式，内置 wsi-demo 源不会出现。 → 补充前提：GLAUX_DEV_MODE=1，或先加载示例数据 / 导入 WSI 文件夹。
- **§前置「Node ≥ 22（~/.nvm/nvm.sh）」与 §5/§7 启动命令**：项目现在有 make -j3 dev 和 scripts/dev/run-backend.sh 等统一入口；单独起 backend 时拿不到 GLAUX_DEV_MODE=1。 → 改成 `make -j3 dev`（或 scripts/dev/），并注明需要开发者模式。
- **§10 后续路径 与 §变更记录**：活文档不留展望和变更简史。 → 删掉这两节。

#### `docs/runbooks/reference-agent-conversations.md`

- 参考 agent 会话 runbook，讲安装、启动、数据目录、会话管理和故障码。数据目录与 env（config.ts）、make 目标都准确；但 §4 仍是「第一阶段不执行领域工具、模型元数据必须手填」，与现状冲突。
- **§4 末句**：runtime 已经注册 run_task / locate_roi / segment_region / consult_atlas / propose_annotation 等工具。权限模式真正控制工具：observe 模式和对话预览版不挂工具（harness-registry.ts:84），suggest 模式下提案要逐条批准。 → 重写成「权限模式决定工具的可用性和审批方式（observe 无工具，suggest 逐条批准……）；对话预览版不挂领域工具」，并列出当前工具。
- **§4 第 3 条**：拉取模型时会自动带入上游元数据，没有就用默认值 128000/8192（见 agent-connection.md 和 connection-probe.ts），不再需要手填。 → 改成「拉取模型时自动带入，缺省 128000/8192，可手改；校验规则不变」，并链接到 agent-connection.md。
- **文首适用范围**：「第一阶段」已经过期；现在的区分是完整版 / 对话预览版。 → 改成「适用于参考智能体（完整版与对话预览版）」，发行包相关内容链接到 chat-distribution.md。
- **§2 启动**：没提到 scripts/dev/ 下的脚本（run-backend.sh、run-agent-runtime.sh、health.sh 已移入）。 → 补一句：也可以用 scripts/dev/ 下的启动和探活脚本。

#### `docs/todo/2026-08-27-001-code-review-tech-debt-audit.zh-CN.md`

- 全仓技术债审计，status in-progress，第七节是持续更新的偿还进度，仍作为待办依据使用。其中 D10 的进度描述已被 2026-09-17 的脚本迁移追上，需要更新状态；审计正文按基线 e7582c6 记录，保持不动。
- **§七「尚未处理」段**：2026-09-17 run-backend.sh / restart-backend.sh / run-agent-runtime.sh / health.sh 已移入 scripts/dev/。「尚未移进」过期；绝对路径是否已去掉需核对脚本。 → 在第七节 D10 行更新为「已移入 scripts/dev/（2026-09-17）」，并按脚本现状写明绝对路径和 token 读取是否已处理；如已全部闭环，就移到已完成表。
- **§六末尾状态说明**：与 frontmatter 的 status: in-progress 以及第七节的进度矛盾。 → 删掉这句，或改成「进度见第七节」。

#### `science-core/eval/README.md`

- 评测 harness 的说明：评测口径、2026-07-06 CUBS 真实数据复现结果、caroSegDeep 真模型验证结果、成功阈。数值和方法学仍是有效参考，只有少量措辞沿用了已删除的四层概念。
- **第 41 行小节标题、第 64 行**：「动作层」属于纲领已删除的「环境四层」 → 标题改为「## 分割模型真模型验证（caroSegDeep，2026-07-06）」；第 64 行改为「分割步骤已用真模型和真实数据验证」
- **第 1 行标题**：「阶段 4」是 2026-07-05 IMT 计划里的阶段号，脱离计划就看不懂；而且 harness 在纲领里专指 Glaux 本身，容易混淆 → 改为「# eval · 评测工具（IMT / HC）」，同时提一句 hc_harness.py（HC 评测）也在本目录
- **第 38 行**：根 README 已按纲领重写，不再写 CUBS 下载方式；下载链接在 science-core/README.md → 改为「见 science-core/README.md 与 .gitignore」

#### `data/ct/README.md`

- CT demo 数据目录说明。命名、CT_ROOT 配置和 runbook 链接都有效，但文件清单没跟上目录现状。
- **第 17-22 行「v0 楔子数据」**：目录里实际还有 ct_001_ref.nii.gz（复现参考 labelmap），README 没列出这个文件，也没说明它不是真 GT → 补一行「ct_001_ref.nii.gz —— TotalSegmentator 输出的 reproducibility reference（非真 GT），生成步骤见 runbook」；小标题「v0 楔子数据」可以改为「demo 数据」
- **第 1 行标题**：P6 楔子是阶段内部代号，不影响正确性，但对新读者没有信息量 → 可选：改为「# CT 体积 demo 数据（ct_abdomen）」

#### `data/wsi/README.md`

- 病理 WSI demo 资产说明。slide_001 及其复现参考的说明准确，backend 报错信息也指向本文件，但目录里的 slide_002.svs 没有记录。
- **第 3-5 行文件清单**：目录里还有 slide_002.svs，来源、许可和用途都没记录；data 目录约定是每个资产都要写清来源 → 查明 slide_002.svs 的来源（查 git log 或 p7 runbook）后补一条，写明来源、许可、尺寸/MPP；如果是临时文件，就从目录里移除

## 保持历史原样（33）

| 文档 | 说明 |
| --- | --- |
| `docs/researches/20260705-02-research-ultrasound-benchmarks.zh-CN.md` | 为超声首个楔子选数据集的调研，已完成使命（CUBS 已选定并实现）。数据集、许可证、模型清单作为资料仍有参考价值，按带日期的历史调研保留原样。 |
| `docs/researches/20260816-01-tech-annotation-exemplar-store.zh-CN.md` | Atlas 的技术选型调研。LanceDB 放在 backend、原图与标记分存、`/atlas/exemplars/search` 等结论都已落地到 backend/app/atlas；决策 D-1～D-10 已被 SDD 03 承接并扩展到 D-21，SDD 03 也把它列为依据。现状以 SDD 03 为准，本文保留原样。 |
| `docs/brainstorms/20260705-01-cubs-imt-first-task.zh-CN.md` | CUBS IMT 首个楔子的需求文档，已 promoted 并实现，按脑暴约定冻结。全文用旧「环境四层（表征/动作/验证/记忆）」和「眼/手」比喻组织，这些已从纲领删除，但作为当时的需求快照保留原样。 |
| `docs/brainstorms/20260816-02-unified-annotation-toolbox.zh-CN.md` | 统一标注工具箱需求，已 promoted 到 SDD 04（现为 implemented），按脑暴约定冻结，现状以 SDD 04 为准。其中个别旧说法属于当时的快照，不必改。 |
| `docs/designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md` | P6 3D CT（TotalSegmentator 肝+双肾）接入设计，已按计划落地（有 VolumeViewer 和 runbook）。文中「护城河贡献：动作层/验证层/记忆层」用的是旧纲领说法，但这是当时的设计记录，结论没有被另一份设计取代，保持原样即可。 |
| `docs/designs/2026-07-14-001-agent-connection-config.zh-CN.md` | 类 ChatBox 的连接配置设计，已标 status: superseded 和 superseded_by（指向退役设计），文首也注明 §5 探测端点迁到 agent-runtime、§3/§4 仍有效。标注已经做完，不需要再改。 |
| `docs/designs/2026-08-13-001-dual-mode-shell.zh-CN.md` | Focus/Workbench 双模式外壳设计稿（v0 形态），后续契约已由 SDD feats/01（implemented v1.4）接管，内容与现状一致。只有一处元数据落后：frontmatter status 还是 reviewed。 |
| `docs/plans/2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md` | P6 3D CT（TotalSegmentator 肝和双肾）楔子的实现计划，已落地：TOTALSEG_LIVER_KIDNEY 仍在 science-core/glaux_core/tasks.py，segment_ts.py 也在；runbook 和代码评审待办都引用它。设计结论没有被推翻，只是代码路径过时，按历史文档保留。 |
| `docs/plans/2026-07-10-001-feat-p7-wsi-nuclei-wedge-plan.md` | P7 病理 WSI 细胞核检测楔子的实现计划，已落地：NUCLEI_DETECTION 在 science-core/glaux_core/tasks.py，segment_wsi.py 和 dataset_wsi.py 也在，runbook 引用它。与新纲领不冲突（显微与病理仍在领域内），只是代码路径过时，按历史文档保留。 |
| `docs/plans/2026-07-13-001-feat-datasource-registry-plan.md` | DataSource 注册表、文件夹导入和开发者模式的计划，已落地：backend/app/datasource_registry.py 的 docstring 和 runbook 都引用它。第 24 行用了“环境四层本体（representation/action/verification/memory）”的说法，但这是在描述当时 capabilities() 的 layer 字段，kernel.py 现在仍在用这个字段，不算与代码冲突，保持原样。 |
| `docs/plans/2026-07-27-001-feat-reference-agent-conversations-plan.md` | 内置参考智能体与本地会话管理（Pi harness、Node sidecar、REST/SSE）的实现计划，已自标 completed。对应的 SDD 00 状态为 implemented，agent-runtime 仍依赖 @earendil-works/pi-agent-core。它与“Glaux 是 harness、模型由用户自带”的纲领一致，不需要改动。 |
| `docs/plans/2026-08-13-001-feat-dual-mode-shell-plan.md` | SDD 01 v1 双模式外壳的实现计划，头部状态 completed；其中“纲领 §5”指 designs/frontend-design-charter，不是产品纲领，所以不受纲领 v2 重写影响。v1.4 分栏已改掉部分布局，但计划本身是当时的记录。 |
| `docs/plans/2026-08-16-001-feat-atlas-plan.md` | SDD 03 Atlas 的实现计划。SDD 03 已是 implemented（T1-T8 已提交），计划作为执行记录保留；头部状态仍写 draft，与实际不符，可顺手改成 completed，但不必改正文。 |
| `docs/plans/2026-08-16-002-feat-unified-annotation-toolbox-plan.md` | SDD 04 统一标注工具箱的实现计划。SDD 04 已 implemented，计划是执行记录；头部状态仍是 draft。 |
| `docs/plans/2026-08-25-natural-image-sam-demo-design.md` | 自然图像 SAM 演示集合的设计（对应 SDD 07），带日期的历史设计。后来 SDD 08 把自然图像数据源合并进上传与数据源编排，但本文记录的是当时的决策，没有与纲领冲突的现行说法。 |
| `docs/plans/2026-08-25-natural-image-sam-demo-plan.md` | SDD 07 的实施计划，已执行完毕；后续由 SDD 08 计划 §3 合并数据源，本文作为历史记录保留。 |
| `docs/plans/2026-08-26-custom-model-id-combobox-design.md` | 连接面板“模型 ID 可输入组合框”的小型设计，已落地，只描述当时的一次 UI 改动，没有与现状冲突的战略说法。 |
| `docs/plans/2026-08-26-focus-conversation-compact-design.md` | Focus 对话区紧凑样式的设计，已落地的一次性 UI 调整，保留原样。 |
| `docs/plans/2026-08-26-proposed-annotation-live-sync-design.md` | propose_annotation 建议态标注实时同步修复的设计，属于 SDD 02/04 链路上的一次修复记录，正文描述与现行架构（agent-runtime 发工具事件、Backend /annotations 作为事实源）一致。 |
| `docs/plans/2026-08-26-release-blocker-fixes-design.md` | 反方核查不支持删除：记录了加 httpx2 开发依赖的原因（旧 httpx 下 TestClient 挂起）和被否决方案，别处没有。 |
| `docs/plans/2026-08-26-version-release-governance-design.md` | 版本治理 SDD 01 的前置设计，方案比较（整体 VERSION + 组件原生清单）已沉淀到 docs/sdd/01-version-release-governance.md，本文保留作为决策留痕，被该 SDD 引用。 |
| `docs/plans/2026-08-26-version-release-governance-plan.md` | 版本治理的实施计划，已执行完（有根 VERSION、CHANGELOG、scripts/version_matrix.py），是历史记录。 |
| `docs/plans/2026-08-30-data-import-first-explorer-plan.md` | SDD 08 数据导入优先文件栏的详细实施计划，已执行（GLAUX_DEV_MODE 缺省已翻为 0）。文中提到根目录 run-backend.sh/health.sh/restart-backend.sh，这些脚本现在在 scripts/dev/ 下，但这是历史计划的当时形态，不必改。 |
| `docs/plans/2026-08-30-explorer-overhaul-master-plan.md` | 统筹 SDD 08 和 SDD 01 v1.4 实施顺序的总计划，两者都已落地（SDD 01 v1.4 于 2026-08-31 implemented）。它是执行顺序的历史记录，门禁里提到根目录 run-backend.sh，属于当时形态。 |
| `docs/plans/2026-08-30-focus-stage-browser-split-plan.md` | SDD 01 v1.4 舞台常驻加浏览器分栏的实施计划，已于 2026-08-31 实现完成，保留为历史记录。 |
| `docs/todo/2026-07-09-001-code-review-multimodal-arch.zh-CN.md` | 2026-07-09 对 feat/multimodal-arch 分支的代码评审待办，按评审时的 HEAD 定位。orchestration 相关条目已划掉并注明失效，/interpret 已移除；这是历史评审记录，而且被 P6/P7 计划引用。 |
| `docs/todo/2026-07-10-001-code-review-p6-3d-wedge.zh-CN.md` | 2026-07-10 对 P6 3D CT 楔子的评审待办，含 v3 真机 e2e 修复记录；已声明半衰期，属于历史记录，被 P7 计划作为教训引用。 |
| `docs/todo/2026-08-19-001-code-review-frontend-quality-uplift.zh-CN.md` | 2026-08-19 前端品质提升阶段（P0–P2 + 图标系统）的收口评审。文中的「纲领 §5 / G11 / M6」指 docs/designs/frontend-design-charter.zh-CN.md，不是产品纲领，所以不受纲领 v2 重写影响；保持原样。 |
| `CHANGELOG.md` | 整体发布记录（0.1.0、0.2.0），按版本记录，属于历史，没有与现状冲突的「当前说明」。 |
| `agent-runtime/CHANGELOG.md` | Agent Runtime 0.2.0 发布记录，属于历史记录。 |
| `backend/CHANGELOG.md` | Backend 0.2.0 发布记录，属于历史记录。 |
| `frontend/CHANGELOG.md` | Frontend 0.2.0 发布记录，属于历史记录。 |
| `science-core/CHANGELOG.md` | science-core 0.2.0 发布记录，属于历史记录。 |

## 仍然准确（5）

| 文档 | 说明 |
| --- | --- |
| `docs/sdd/README.md` | SDD 索引与生命周期。公共规范 01 和 Feature 00～09 的状态、备注与各 SDD 文件 §0 一致（02、04、07、08、09 均为 implemented），没有纲领层面的过期说法。 |
| `docs/sdd/feats/06-icon-system/README.md` | 统一图标系统 SDD（lucide-react、Icon 组件、iconMap 映射）。已对照代码核实：lucide-react 已引入，TOOL_ICON/KIND_ICON/FALLBACK_ICON 在用，components 下没有残留 emoji。正文不涉及产品定位，也没有引用纲领章节，内容仍准确。 |
| `docs/sdd/feats/08-data-import-first-explorer/README.md` | 数据导入优先文件栏 SDD。已核实 uploads.py、upload_store.py、ImportPanel.tsx 都存在；datasource_registry.dev_mode() 缺省为 0；scripts/dev 下的启动脚本显式设置 GLAUX_DEV_MODE=1，§8 的路径已经是 scripts/dev/run-backend.sh。内容与代码一致。 |
| `models/hc_seg/README.md` | HC 隔离分割模型的来源、部署、推理管线和验证结果。对照 backend/app/config.py，GLAUX_HC_SEG_* 默认路径、fetal_hc 模态和 hc_harness.py 都还在，内容准确，也没有定位类说法。 |
| `data/natural/README.md` | 自然图像 SAM 演示资产的来源、许可和提示词清单（SDD 07 要求保留），与纲领「自然图像与视频」领域一致，内容准确。 |

## 执行进度（2026-09-22）

已完成：

- 文档治理规则与 frontmatter：`docs/README.md`「活文档与记录」、`AGENTS.md`、65 份文档补齐 `kind`/`status`。
- P1 入口文档：`docs/architecture.zh-CN.md` 重写、`docs/landing/index.html` 按纲领重写、backend / science-core / scripts/dev 三份 README、前端设计纲领。
- P3 全部 10 份：六份 runbook（含 p7 的 orchestration PYTHONPATH）、`science-core/eval`、`data/ct`、`data/wsi`、技术债审计 D10 进度。
- P2 已做 10 份：SDD 00 / 01 / 03 / 05、版本治理 SDD、脑暴索引与 agent-browser-capability、退役设计、前端质量路线图、docs/README 调研条目。

未完成：

- SDD 02 / 04 / 07 / 08 与 `docs/sdd/README.md`：等 SDD 10（对象收敛）落地后一并改，避免与并行会话冲突。
- 需维护者拍板：`docs/plans/2026-08-26-release-blocker-fixes-plan.md` 是否删除；SDD 01 版本治理与退役设计是否升为 `accepted`；落地页未被引用的插画是否删除。
- 非文档项：agent-runtime 系统提示词仍写 biomedical；`science-core/pyproject.toml` 的 description 仍是「首个楔子 CUBS IMT」。
