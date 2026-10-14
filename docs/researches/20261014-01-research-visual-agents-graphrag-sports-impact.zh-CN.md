---
kind: record
status: done
---

# 视觉 Agent、GraphRAG 与体育垂类分析：研究核对及 Glaux 影响

日期：2026-10-14。承接 [VISTA 调研](20261013-01-research-vista-visual-memory-impact.zh-CN.md)。

目的：核对用户提供的两组研究线索，提炼对 Glaux 的观察、工具、记忆、验证与垂类评测有用的结论。本文是调研记录，不推进 SDD 状态，不承诺新功能，也不启动此前暂缓的模型评测。

## 1. 结论

**总体仍是中等程度的设计影响：先加强主动观察与证据评测，再按失败原因增加领域工具；现有材料不足以支持重建 Atlas、训练自有 Agent 或默认采用多 Agent。**

与 VISTA 单篇调研相比，本轮新增三个重要判断：

1. 保存历史图像解决的是“能否回看”；主动选择区间、区域或视角解决的是“下一步看什么”。两者需要组合验证。
2. 工具调用格式正确、图像坐标合法、证据引用存在，都不能证明画面判断正确。应把感知、工具执行、证据支持和答案质量分开评测。
3. 体育垂类应先形成“谁在何时何处做了什么”的可检查表征，再验证规则解释或战术分析。解说流畅、模型自报置信度高和有推理过程，都不是事实成立的充分依据。

以上是本文对文献与项目的综合判断，并非任何论文直接验证了 Glaux。

## 2. 核对方法与证据范围

- 一手来源优先：CVF／AAAI／ACL 会议页面、arXiv 固定版本正文、作者项目与代码入口。用户提供的聚合页面仅作为线索。
- 重点正文核对：SportMV v2 的表 1–3与工具实现；VisHarness 的 §3–4；DeepSport v2 的 §3–4；TennisTV v3 的表 1–2；TennisExpert v2 的数据生成与验证流程；EvoGraph-R1 v1 的动作与训练设计。
- M³KG-RAG 核对了作者页面的流程和评测口径；CVF 正文链接本次直接读取被拒绝，会议归属由 CVF 检索结果与作者页面交叉确认。未逐项复算结果。
- 其余工作主要核对一手摘要、版本或会议信息，不将其摘要中的提升数字作为架构决策依据。
- 未下载新视频、安装模型、审计上游代码或复现实验；公开代码入口与数据下载说明不等于本机已验证可用。数据许可与版本在实际选用时仍须逐项确认。
- 项目现状核对 [纲领](../roadmaps/charter.zh-CN.md)、[SDD 03](../sdd/feats/03-atlas/README.md)、[SDD 11](../sdd/feats/11-video-understanding-harness/README.md)、[SDD 22](../sdd/feats/22-agent-visual-inspection/README.md) 及已有评测计划。本轮不重复上篇报告的代码盘点。

## 3. 对原始线索的修正

| 原始线索 | 核对后的结论 | 对判断的影响 |
| --- | --- | --- |
| SportMV 为 787 组视频、2592 题、相对提升 14.46% | [v2](https://arxiv.org/html/2607.11844v2) 已改为 1022 组、3015 题；表 2 为 59.12% → 68.35%，即 +9.23 个百分点／相对 +15.61% | 数字需固定版本；不同版本结果不能混用 |
| SportMV 使用感知工具 | v2 正文说明控制器为 GPT-4.1，感知工具由 Qwen2.5-VL-72B 实现 | 不能把这些工具都理解为已有独立检测器；额外模型调用与预算需要计入比较 |
| Harness 研究核心是不微调模型 | [VisHarness](https://arxiv.org/html/2605.29894v1)、[DeepSport](https://arxiv.org/html/2511.12908v2)、[EvoGraph-R1](https://arxiv.org/html/2607.12764v1) 都训练了 Agent 策略 | “可调用工具的环境”与“训练调用工具的模型”是不同投入 |
| DeepSport 构建 78K 训练轨迹 | 摘要称 78K 样本；v2 正文区分约 14K CoT SFT 样本与 63K RL 问答提示 | 不宜把所有样本都当作已验证完整执行轨迹 |
| SportR 为 5017 图像、2101 视频 | [v3](https://arxiv.org/abs/2511.06499v3) 摘要更新为 4789 图像、2052 视频 | 与 v1 规模不同；视觉框标注不能直接当作视频时间金标准 |
| TennisTV 所有模型仅略高于随机 | [v3 表 1](https://arxiv.org/html/2509.15602v3) 最强所测模型 45.1%，随机 27.9%，人类 89.2% | 应说整体仍远低于人类，部分任务接近或低于随机；论文模型榜单不是当前所有模型的结论 |
| MMGraphRAG 于 2026 年 3 月更新 | [arXiv](https://arxiv.org/abs/2507.20804v3) 还有 2026-07-18 的 v3 | 以版本号引用，不以旧摘要更新时间代表现状 |
| GRAIL-V 于 6 月 3–4 日举办 | [最终官网议程](https://grailworkshops.github.io/) 为 6 月 3 日上午半天 | 征稿公告和最终议程需区分 |
| SoccerTrack-v2 是 10 场职业比赛测试版 | [作者当前项目页](https://atomscott.github.io/SoccerTrack-v2/) 说明大学业余球员、知情同意与数据许可，已有下载入口 | 不能用个人主页介绍代替当前数据说明；本次未下载核验完整性 |
| 体育综述只是 8 月预印本 | 同名同作者工作已有 [ACL 2026 Findings 记录](https://aclanthology.org/2026.findings-acl.1851/) | arXiv 发布日期不能直接决定是否经过会议审稿 |

会议归属核对：ToolsRL 为 CVPR 2026 Findings；ARM-Thinker、M³KG-RAG、EvoGraph-R1 为 CVPR 2026；VipAct 为 AAAI 2026；MT-Video-Bench 为 ACL 2026 Findings。COACH 的 arXiv v2 注明 AAAI 2026 LaMAS Workshop，不能按 AAAI 主会引用。对应一手入口见 §9。

## 4. 最值得借用的机制

### 4.1 先改善观察，而非默认增加推理长度

SportMV v2 表 1 中，Qwen3-VL-30B 的全视角输入为 43.26%，引导优先使用适当视角为 49.04%；提供人工标注动作／接触的 Oracle Tool 为 64.98%。Oracle 是诊断上限，不是可部署工具的性能。表 3 去掉主动视角选择后，完整方案从 68.35% 降到 60.63%。这些结果局限于该基准和模型。[正文](https://arxiv.org/html/2607.11844v2)

对 Glaux 的推论：如果问题是球太小、接触被遮挡、关键瞬间未被采样，增加领域知识或长文本推理并不直接补回缺失像素。应先允许缩短观察区间、聚焦区域、回看历史观察；只有存在同一事件的其他素材时，才讨论视角选择。

多视角是一项独立的高影响能力：需要视频束、视角身份、事件对应和时间对齐。SportMV 的视角可能不同步，不能把两个文件同样的毫秒数当作同一时刻。当前 SDD 11 的源视频时间轴不能直接承担这一语义。

### 4.2 历史记忆与有界上下文可以同时成立

VisHarness 将旧视觉反馈替换为紧凑文字占位以控制 token，并通过 SFT＋GRPO 学习调用异构专家；其流程不是 VISTA 式完整历史原图回看。[§3–4](https://arxiv.org/html/2605.29894v1)

对 Glaux 的推论：现有图像裁剪策略有工程合理性，值得补的是可恢复引用及历史观察入口。模型本次请求保持有限图像，源数据和必要产物在外部保留，属于两层不同的成本管理。不能因 VISTA 保存视觉记忆就取消裁剪，也不能因 VisHarness 使用占位就只保存文本。

### 4.3 工具使用应以有效证据增益为目标

DeepSport 的训练奖励区分初始帧是否已足以回答，避免对所有调用工具的样本一律奖励；它训练的是主动抽帧策略，不是音画联合观察系统。[§3](https://arxiv.org/html/2511.12908v2)

MM-ToolSandBox v2 摘要报告最强被测模型任务成功率仍低于 50%，53% 的失败来自图像信息提取错误；EASEL 则把视觉判断与连续参数执行精度一起评测。[MM-ToolSandBox](https://arxiv.org/abs/2607.11818v2)、[EASEL](https://arxiv.org/abs/2608.25417v1)

对 Glaux 的推论：调用次数不是质量指标。标注闭环要同时检查“框在哪”“参数如何变换”“复看后是否更正确”；多次修订也可能越改越差。应记录每次观察是否消除了一个具体不确定点，以及错误来自感知、坐标、工具还是结论。

### 4.4 证据验证需要分层

ARM-Thinker 的特点是评分前可以裁剪图像、检索文档页，主动核验细节；其工具使用与判断能力经过 RL 训练。[CVF](https://openaccess.thecvf.com/content/CVPR2026/html/Ding_ARM-Thinker_Reinforcing_Multimodal_Generative_Reward_Models_with_Agentic_Tool_Use_CVPR_2026_paper.html)

对 Glaux 的推论：可借用“提出结论后检查所引用原始证据”的过程，而不是直接把奖励模型当作事实裁判。建议评测时区分四层：

| 层 | 检查对象 | 当前关系 |
| --- | --- | --- |
| 契约有效性 | id、坐标、区间、源版本、格式 | runtime 的确定性校验可承担 |
| 感知准确性 | 号码、动作、位置、接触是否识别正确 | 需要人工标注或已验证领域方法 |
| 证据支持性 | 引用的片段是否支持这条具体事实 | SDD 11 当前仍依赖人工语义复核 |
| 解释有效性 | 规则适用、战术解释是否成立 | 需要明确任务、规则版本和评价标准 |

同一个 VLM 在相同低分辨率画面上再次评价，不提供独立证据。批评 Agent 只有在取得新视角、更精细观测或不同验证方法时，才可能实质增加可靠性。

## 5. Atlas 与 GraphRAG：可借用原则，不必立即换存储

Atlas 的“图谱”是带原图和 ROI 的案例库；GraphRAG 的“图”是实体关系结构。这两种产品对象不能因名称接近而合并。

M³KG-RAG 的 GRASP 先检查实体在音／画面中是否存在，再裁掉无关知识；作者页面报告的是 Model-as-Judge 分数，不能等同于事实正确率。[项目页](https://kuai-lab.github.io/cvpr2026m3kgrag/)

EvoGraph-R1 支持检索、搜索、编辑与回答，并用 GRPO 优化策略；其奖励包括结构格式、答案词元重合和执行成本，不能将“有轨迹”直接理解为所有新增知识经过独立事实验证。[§3.5](https://arxiv.org/html/2607.12764v1)

HVM-GraphRAG 关注概念与原始多模态块的可靠索引和检索成本；MMGraphRAG 关注视觉场景图与文本实体对齐。它们提供的是复杂跨模态文档／知识检索依据，不是 Atlas 参考图定位的直接对照实验。[HVM](https://arxiv.org/abs/2607.24861v1)、[MMGraphRAG](https://arxiv.org/abs/2507.20804v3)

对当前设计的建议：

- 保留标签／文本召回和精选案例图，先测案例是否真正帮助用户图像定位；加入“相似但不相关”的干扰案例，观察检索是否诱导误判。
- 允许按已引用案例复查及补充检索，是中等影响增量；无需先构建知识图。
- 动态编辑可先限制在任务中的待验证材料；跨任务的权威案例库仍应保留人工策展。不要让一次错误判断自动修改后续任务的先验。
- 只有固定任务确实需要跨规则、事件、球员、片段等关系多跳查询，并且平铺索引失败时，才比较关系表／时间索引与 GraphRAG。若图方案没有提高证据定位、答案正确率或成本表现，就没有引入理由。

## 6. 体育垂类：应分别建设和评价的能力

TennisExpert 把记分牌、逐拍事件、落点与球员位置组织成语义表征，再结合分层记忆生成分析。其参考解说由 Gemini 3 Pro 融合逐拍数据和转写生成，部分样本经过人工抽查；因此不能把全部战术解说当作人工确定的因果真值。[v2 §3](https://arxiv.org/html/2603.13397v2)

FOOTPASS 关注整场的球员中心事件序列；SetPieceRAG 关注足球中需要外部知识的 VQA，并结合域内语料、搜索及其他任务适配。两者说明“动作感知”和“外部知识缺失”是不同问题。[FOOTPASS](https://arxiv.org/abs/2511.16183)、[SetPieceRAG，CVPR Workshop](https://openaccess.thecvf.com/content/CVPR2026W/CVsports/html/Kim_SetPieceRAG_Domain-Specific_RAG_for_Knowledge-Intensive_Soccer_VQA_with_Large_Language_CVPRW_2026_paper.html)

建议将垂类问题分层，而不是将“赛事分析”视为一个总分：

| 层次 | 示例 | Glaux 的合适产出／评测 | 主要边界 |
| --- | --- | --- | --- |
| 感知 | 谁击球、球落在哪里 | 身份、动作、区域与源时间；识别正确率、定位误差 | 看不清时报告不可判断 |
| 事件 | 某次回合如何结束、接触何时发生 | 可检查的事件序列与原始证据；时间 IoU、事件匹配 | 错误关联身份与动作会污染后续分析 |
| 规则解释 | 哪条规则与该事件相关 | 可见事实与规则依据分开呈现，核对规则版本 | 规则知识不补回被遮挡的事实；正式裁决属于上层应用 |
| 战术分析 | 某球员是否持续攻击反手 | 跨回合的可复查统计与候选解释 | 趋势关联不等于球员意图或反事实因果 |
| 摘要／解说 | 生成精彩回合描述 | 事实支持率、关键事件覆盖、错误实体数量 | 流畅性和偏好评分只作补充 |

按 [纲领](../roadmaps/charter.zh-CN.md)，Glaux 从视觉到理解与可计算表征；用表征做规划与决策由上层应用承担。可以研究规则相关问答的证据能力，不因此默认将产品定位扩展为裁判或教练决策系统。

近期建议以网球回合为主要验证对象，理由来自本仓已有数据准备和评测驱动，而非宣称它是最优商业市场。篮球可用现有 BARD 研究事件与音频作用；足球全场和多机位先作为后续契约需求来源。

同样的分层可以用于项目已有的 TEM／WSI：先测区域感知、测量与证据，再测参考案例是否减少误判。体育论文没有直接证明这些模态上的效果，不跨领域搬运提升百分比。

## 7. 对 Glaux 的具体影响与验证顺序

| 候选方向 | 影响程度 | 涉及规范 | 建议 |
| --- | --- | --- | --- |
| 固定任务按失败类型分项评测 | 低至中 | SDD 11／22，评测记录 | 优先；建立证据支持率与成本基线 |
| 主动缩区间、调观察密度、看局部 | 中 | SDD 11／22／10 | 优先验证；现有参数能做一部分，视频 ROI 不能按已有图像 ROI 能力宣称已具备 |
| 历史观察访问与指定案例复查 | 中高 | SDD 15／19／21／22／03 | 承接 VISTA 报告；先冻结源版本和恢复语义 |
| 领域感知工具及其输入输出验证 | 中高 | 新任务能力与注册表契约 | 由具体感知失败驱动；单独测专家错误传播，不预置一大套工具 |
| 跨回合结构化事件与统计 | 中高 | 独立事件表征 SDD，与 11／10 关联 | 在短回合基线成立后考虑；需要身份和时间关联 |
| 同一事件多机位访问 | 高 | 新视频束／时间对齐契约 | 有真实多视角任务再立项；不能靠多个文件加提示词代替 |
| 持久化动态知识图、自动修改 Atlas | 高 | 新知识层及权限／版本／策展边界 | 当前证据不足，递延 |
| 自训工具策略、多 Agent 默认编排 | 高 | 训练数据、评测、运行成本与独立验证设计 | 当前不作为首要投入；文献整套系统分数不构成必要性证明 |

建议的对照设计：固定模型、推理设置、总观察时长／字节／token 预算，比较现有观察、主动局部复查、加入一个领域工具三种条件；多视角只在有对应素材时单独成组。每个任务重复运行，报告正确率、证据支持率、拒答率、调用次数、时延和成本。

TennisTV 表 2 的 Qwen2.5-VL-7B 在 32 帧时为 38.8%，64 帧为 38.4%，说明该条件下更多帧没有稳定收益；不能据此冻结 Glaux 的统一最佳帧率。[v3](https://arxiv.org/html/2509.15602v3)

本仓 [TennisTV／BARD 计划](../plans/2026-09-25-video-eval-tennistv-bard-plan.md) 记录 E1／E2 已完成、E3／E4 暂缓。10 题冒烟的选项正确率为 5/10，MGG 时间 IoU 为 0.31／0.00／0.31，样本不足以得出模型效果结论；但它提示应同时检查时间证据。若以后恢复评测，建议分别统计自由文本答对率与有效结构化证据答案的正确率，避免没有提交证据的答案混入“已验证”结果。本次不恢复暂缓工作。

MT-Video-Bench 可补充多轮追问、记忆回查、拒答和话题切换的测例设计；不能用一轮选择题代表完整会话能力。[ACL Findings](https://aclanthology.org/2026.findings-acl.397/)

## 8. 下一轮深读与数据选择

优先次序：SportMV（主动观察与感知诊断）→ TennisExpert（事件表征与分层记忆）→ MM-ToolSandBox／EASEL（错误归因与执行精度）→ M³KG-RAG（检索后的支持性过滤）。GraphRAG 的其他工作保留为多跳任务出现后的方案比较材料。

数据接入建议保持分层：

- **已有本机基础**：TennisTV／BARD，依据已有调研和计划；本次未重新验证远端文件状态。
- **可查到公开入口**：TennisExpert 仓库有片段与权重访问说明；SoccerTrack-v2 作者站有数据下载与格式说明。未下载、未确认清单完整性，不直接替换当前评测集。[TennisExpert 仓库](https://github.com/LZYAndy/TennisExpert)、[SoccerTrack-v2](https://atomscott.github.io/SoccerTrack-v2/)
- **正文方法已读但未验证可复现数据**：SportMV；本次未确认完整视频、QA、许可和切分的可下载闭环。
- **需额外标注或跨契约能力**：专家战术解释、多机位裁决、长比赛事件序列；不能直接当作当前短视频问答的验收集。

数据泄漏应单独检查：解说可能直接说出答案，外部结构化比赛数据可能提供赛果，知识检索可能返回对应题目。评测应分别说明允许使用的模态和外部来源。音画／静音对照衡量的是音频的净贡献，不自动证明模型看清了关键视觉事件。

## 9. 一手来源导航及阅读深度

正文重点核对的来源已在各节就近链接；以下补齐用户其余线索。未列实验细节的项目仅完成摘要或元数据核对。

| 工作 | 一手入口 | 本次用途／阅读深度 |
| --- | --- | --- |
| ToolsRL | [CVPR Findings](https://openaccess.thecvf.com/content/CVPR2026F/html/Dong_Visual_Reasoning_Through_Tool-Supervised_Reinforcement_Learning_CVPRF_2026_paper.html) | 摘要与会议：先训练工具操作，再训练任务答案；属于模型训练路线 |
| ARM-Thinker | [CVPR](https://openaccess.thecvf.com/content/CVPR2026/html/Ding_ARM-Thinker_Reinforcing_Multimodal_Generative_Reward_Models_with_Agentic_Tool_Use_CVPR_2026_paper.html) | 摘要与会议；主动核验的设计参照，未复算数字 |
| AgentVista | [arXiv v2](https://arxiv.org/abs/2602.23166v2) | 摘要；长链、跨来源任务评测；与 VISTA 不是同一工作 |
| AgenticNav | [arXiv v3](https://arxiv.org/abs/2606.10577v3) | 摘要；按需查询度量深度与选择性回忆，机器人结果不直接迁移 |
| WAA | [arXiv v1](https://arxiv.org/abs/2609.29964v1) | 摘要；动作预演、修订与轨迹训练；机器人控制超出项目边界 |
| Robo-Harness K1 | [arXiv v1](https://arxiv.org/abs/2609.29389v1) | 摘要；将标定感知暴露为工具，保留域内适用性限制 |
| VipAct | [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/40976) | 会议页面；专用 Agent 协作，不作为默认多 Agent 的效果证明 |
| KG4VD | [arXiv v1](https://arxiv.org/abs/2606.28780v1) | 摘要；长文档全局问答，页面检索与图查询候选 |
| COACH | [arXiv v2](https://arxiv.org/abs/2512.01853v2) | 摘要；羽毛球问答与摘要，作者注明 LaMAS Workshop |
| SportR | [arXiv v3](https://arxiv.org/abs/2511.06499v3) | 摘要；感知、规则与区域定位分层，核对新版规模 |
| FOOTPASS | [arXiv](https://arxiv.org/abs/2511.16183) | 摘要；球员中心整场事件表征 |
| SoccerNet 2026 FOOTPASS 扩展 | [arXiv](https://arxiv.org/abs/2606.09679) | 标题与元数据；是一篇基线扩展工作，不能代替整个挑战赛官方规范 |
| 体育大模型综述 | [ACL Findings](https://aclanthology.org/2026.findings-acl.1851/) | 元数据与摘要；方向索引，不以综述替代一手实验 |
| RoboCup 自动解说 | [arXiv](https://arxiv.org/abs/2607.14809) | 标题与元数据；机器人比赛场景，不作为转播视频泛化证据 |
| GRAIL-V | [官方议程](https://grailworkshops.github.io/) | 检索、推理、核验方向入口，非单篇实验 |
| CVSports | [官方议程](https://vap.aau.dk/cvsports/12th-international-workshop-on-computer-vision-in-sports-cvsports-at-cvpr-2026/program/) | 核实 From Tracking to Understanding 报告与 SetPieceRAG；议程本身不证明具体瓶颈或难题排名 |

后续设计判断以领域实测和正式 SDD 为准。论文中的趋势与高分结果，可以形成候选假设，不能直接转成产品正确性承诺。
