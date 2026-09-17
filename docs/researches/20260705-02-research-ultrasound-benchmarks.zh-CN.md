---
kind: record
status: done
---

# 公开超声图像基准调研

> **用途**：为 Glaux 首个楔子（超声，自然语言驱动"分割 + 测量"）选定数据集与验证策略提供依据。
> **日期**：2026-07-05 · **类别**：research（科研） · **状态**：v1
> **依据**：[纲领](../roadmaps/charter.zh-CN.md) · [需求清单 §1.2](../requirements.zh-CN.md) · [路线图 阶段 4](../roadmaps/20260705-product-roadmap.zh-CN.md)
> **半衰期提醒**：数据集/挑战赛/许可证会变；许可证与下载条款使用前请到原始页面复核。

## 0. 一页纸结论

**选型目标**（对齐需求）：首个楔子要的是——① 有**像素级分割掩膜**；② 有**测量端点**（segment→measure，如围长/尺寸/EF/厚度）；③ **多中心/多厂商**（支撑 leave-one-center-out 外部验证——这是我们最强的证明）；④ **许可证宽松**；⑤ 规模合理；⑥ 非专家研究者有真实需求。

**关键发现**：公开超声领域**单中心分割集很多，但"多中心 + 测量端点 + 全开放许可证"三者兼备的极少**。这本身是信号——外部验证/校准这层，公开世界给不全，正是 Glaux 验证层（护城河）的机会；很多时候要**自己拼装跨中心验证集**。

**推荐（详见 §5）**：
- **首选起步 = 胎儿生物测量**：**HC18**（胎儿头围）做最干净的启动 demo（全开放、简单、HC 以 mm 计、有活跃榜），配 **ACOUSLIC-AI**（胎儿腹围，真·多国多中心）做外部验证故事。
- **强力黑马 = CUBS（颈动脉 IMT）**：公开集里**唯一**同时"多中心 + 全开放（CC BY 4.0）+ 直接 mm 测量"的数据集。
- **认知度选项 = CAMUS（心脏 LV→EF）**：经典、EF 家喻户晓，但单中心单厂商、非商用许可证。

**许可证的关键区分**：Glaux **集成现成模型、不自研分割器**，所以数据集主要用于**评测 / 外部验证 / 校准不确定**——**这类用途下 CC BY-NC（非商用）通常可用**；只有"把数据用于训练并随产品发行"才会被 NC 卡住。这一区分把可用集大大扩宽（CAMUS、ACOUSLIC-AI、EchoNet 等都能用于评测）。

---

## 1. 按解剖的数据集清单

评级重点：**掩膜？** · **测量端点？** · **多中心？** · **许可证** · **规模**。

### 1.1 胎儿 / 产科（segment→measure 最干净的一类）

| 数据集 | 任务 / 端点 | 规模 | 掩膜 | 多中心 | 许可证 / 获取 |
| --- | --- | --- | --- | --- | --- |
| **HC18** | 头围 HC（分割头→拟合椭圆→mm） | 1,334 图 / 551 孕妇 | 椭圆轮廓 + HC(mm) | ❌ 单中心（Radboudumc） | **CC BY 4.0，全开放** · [Zenodo](https://zenodo.org/records/1327317) · [grand-challenge](https://hc18.grand-challenge.org/)（2026 仍活跃，~1037 参与者） |
| **ACOUSLIC-AI** | 腹围 AC（盲扫视频，选帧→分割腹部→AC mm） | 300 训练卷 / 每卷 6 sweep | 多类掩膜 + AC(mm) CSV | ✅ **多国**：塞拉利昂 3 + 坦桑尼亚 2 + 荷兰 1（单机型 Telemed） | **CC BY-NC-SA 4.0** · [Zenodo](https://zenodo.org/records/12697994) · [challenge](https://acouslic-ai.grand-challenge.org/) |
| **PSFHS / IUGC** | 耻骨联合+胎头分割→产程角度(AoP) | PSFHS 1,358 图 / 1,124 人；IUGC2024 774 视频/3 院；IUGC2025 3 万+图/20+机构 | 像素掩膜 | ✅ 多中心且快速增长 | **CC BY 4.0**（PSFHS）· [Zenodo](https://zenodo.org/records/10969427)；IUGC 视频需签 DUA |
| **Fetal Planes DB** | 标准切面分类（非分割） | 12,400 图 | ❌ 仅类别 | 2 院（BCNatal） | CC BY 4.0 · [Zenodo](https://zenodo.org/records/3904280)。**用途：切面路由**（判断是 HC 面还是 AC 面） |
| **Fetal Abdominal Structures**（Mendeley 2023） | 腹部子结构分割（主动脉/脐静脉/胃/肝） | ~1,500 图 / 169 人 | 多结构掩膜 | 单中心但**多厂商**（Siemens/GE/Philips） | CC BY 4.0 · [Mendeley](https://data.mendeley.com/datasets/4gcpm9dsc3/1) |

> **要点**：HC18 是教科书级 segment→measure，但单中心；ACOUSLIC-AI / PSFHS 是 2024–25 的多中心后继者，天生带外部验证/低资源泛化叙事。核透明度（NT）**无公开集**——是空白。

### 1.2 心脏 / 超声心动（测量端点强、认知度高）

| 数据集 | 端点 | 规模 | 掩膜 | 多中心 | 许可证 |
| --- | --- | --- | --- | --- | --- |
| **CAMUS** | LV/心肌/LA 分割→容积/EF | 500 人 / ~2000 标注帧 | 像素掩膜 | ❌ 单中心单厂商（GE Vivid E95）；作者故意保留 ~19% 低质图 | 开放，需引用 · [下载](https://humanheart-project.creatis.insa-lyon.fr/database/) |
| **EchoNet-Dynamic** | LV 描迹→EF（视频） | 10,030 视频 | 仅 ED/ES 描迹 | ❌ 单中心（Stanford） | 非商用 DUA、需注册 · [AIMI](https://aimi.stanford.edu/datasets/echonet-dynamic-cardiac-ultrasound) · [code MIT](https://github.com/echonet/dynamic) |
| **EchoNet-LVH** | 室壁厚度/内径测量 | 12,000 视频 | 测量非掩膜 | ✅ **Stanford+Cedars-Sinai+Unity**（最跨中心的 EchoNet） | 公开 DUA 式 · [echonet.github.io/lvh](https://echonet.github.io/lvh/) |
| **Unity Imaging Collaborative** | LV 线性测量/应变（关键点） | >7,500 图 / **17 家英国医院** | 关键点 | ✅ 多中心典范 | CC BY-NC-ND · [data.unityimaging.net](https://data.unityimaging.net/) |
| **MITEA** | 3D 超声 LV 分割（CMR 锚定金标准）→EDV/ESV/EF/质量 | 134 人 / 536 卷 | 3D 掩膜 | 混合队列（站点数未证实） | CC BY-NC-SA，需申请 · [Cardiac Atlas](https://www.cardiacatlas.org/mitea/) |
| HMC-QU | MI 检测 + LV 壁分割 | 162 人 / 322 视频（109 带掩膜） | 子集掩膜 | 单中心双厂商 | Kaggle（许可证未证实） |

### 1.3 乳腺

| 数据集 | 规模 | 掩膜 | 多中心 | 许可证 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **BUSI** | 780 图 / 600 人 | 是 | ❌ 单中心 | **CC0** | ⚠️ **已知质量问题**：~19% 重复、8% 实为腋窝、285 图带文字/卡尺叠加；清洗后仅 ~399 可用。**勿裸用做基准** |
| **BUS-BRA** | 1,875 图 / 1,064 人 | 是 | 单院**多机型（4 台）** | CC BY 4.0 | 活检确诊 + BI-RADS，近期较强 · [Zenodo](https://zenodo.org/records/8231412) |
| **BrEaST** | 256 人 / 266 病灶 | 是 | 有限 | CC BY 4.0（TCIA） | 首个把患者/图像/病灶级标签 + 病理一体化 |
| **BUSIS** | 562 图 | 是 | ✅ **真多中心**（3 院 5 机型） | **需签 DUA** | 乳腺里最强跨厂商泛化集，但门禁 |
| **TDSC-ABUS**（2023 挑战赛） | 200 个 **3D** ABUS 卷 | 3D 掩膜 | 单机构 | grand-challenge | 3D 自动乳腺超声，另一形态 |

> 测量端点：病灶掩膜→最大径/面积（肿瘤尺寸随访，临床标准）。

### 1.4 甲状腺

| 数据集 | 规模 | 掩膜 | 多中心 | 许可证 |
| --- | --- | --- | --- | --- |
| **TN3K / TG3K** | TN3K 3,493 图 / 2,421 人 | 结节/腺体掩膜 | ❌ 单中心（珠江医院） | 研究用 · [GitHub](https://github.com/haifangong/TRFE-Net-for-thyroid-nodule-segmentation) |
| **DDTI** | 134~637 图（**多版本不一致**） | 轮廓 + TI-RADS | 单源单机 | 开放（Kaggle 等） |
| **Stanford Thyroid Cine** | 192 clip / 167 人 / 17,412 帧 | 逐帧掩膜 + 尺寸 + 病理 | 单中心（视频独特） | 注册 + 非商用（商用费用高） |
| **ThyroidXL**（MICCAI 2025） | 11,545 图 / **4,093 人** | 分类为主（掩膜未证实） | 单机构但量大、病理确诊 | 下载入口待确认 |

> 端点：结节掩膜→最长径（TI-RADS 标准尺寸）。**无原生多中心甲状腺分割集**——跨中心得靠"不同国家的不同单中心集"拼（DDTI/TN3K/Stanford/ThyroidXL）。

### 1.5 颈动脉 / 血管（黑马所在）

| 数据集 | 端点 | 规模 | 掩膜 | 多中心 | 许可证 |
| --- | --- | --- | --- | --- | --- |
| **CUBS** | **颈动脉内中膜厚度 IMT（mm，直接）** | 2,176 图 / 1,088 人 | 3 位专家边界 + 5 种算法输出 | ✅ **2 中心** | **CC BY 4.0，全开放** · [Mendeley](https://data.mendeley.com/datasets/fpv535fss7/1) |
| CSV/CPS（ISBI 2026 挑战赛） | 斑块分割 + 狭窄量化 | 1,500 对图 / 7–12 院 / 12 机型 | 半监督（10% 标注） | ✅ 首个大规模多中心多机 | [csv-isbi.net](https://csv-isbi.net) |

> **CUBS 是本次调研里"多中心 + 全开放 + 直接测量"唯一三满足者**。IMT 是动脉粥样硬化/心血管风险的临床标准测量，还带长期结局随访数据（"非专家为何在乎"的故事强）。局限：仅远壁 CCA，不含斑块。

### 1.6 前列腺 / 肾 / 腹部 / 肝 / 肌骨 / 肺 / 神经（多为空白或单中心）

| 数据集 | 部位 | 掩膜/端点 | 多中心 | 许可证 |
| --- | --- | --- | --- | --- |
| **MicroSegNet** | 前列腺（micro-US） | 全腺掩膜→体积 | ❌ 单中心 | CC BY 4.0 · [Zenodo](https://zenodo.org/records/10475293) |
| μ-RegPro | 前列腺 MR-TRUS 配准 | 地标（非分割） | 不明 | 开放（MICCAI 2023） |
| **Open Kidney US** | 肾（4 类） | 像素掩膜→长度/皮质厚 | 多厂商 | CC BY-NC-SA，需注册 |
| TRUSTED | 肾 US-CT | 3D 掩膜 | 单机构 | 需 DUA（2025 新） |
| CLUST | 肝（地标追踪） | 地标 | 多机型 | 传统（2014） |
| **肌骨（肌/腱）** | — | — | — | **无公开分割集**（仅机构私有） |
| POCUS / ICLUS | 肺 | ❌ 仅分类/评分 | 多源/多中心 | 混合 / 登录门禁 |
| Kaggle 神经分割 | 臂丛神经 | 掩膜（无测量） | 单源不透明 | Kaggle（~60% 空掩膜，标签噪声大） |

> 肝（纤维化/脂肪变分级）、肌骨、颈动脉斑块、核透明度——**均为公开数据空白**，只有机构私有队列。

### 1.7 通用 / 多器官聚合 & 挑战赛

- **US-43d / UltraSam**（2024）：聚合 **43 个开放超声分割集、28 万+图、50+ 结构**——"公开超声掩膜到底有什么"的最佳地图 · [arXiv](https://arxiv.org/pdf/2411.16222) · [GitHub](https://github.com/CAMMA-public/UltraSam)
- **US30K**（训练 SAMUS 用）：TN3K+DDTI+TG3K+BUSI+UDIAT+CAMUS+HMC-QU 聚合
- **UUSIC25**（MICCAI 2025）：多器官多任务"通用超声 AI"挑战赛——与 Glaux 目标最接近的先例
- **MMOTU**（卵巢肿瘤）、**USEnhance2023**（5 器官图像增强）、**TUS-REC**（无跟踪 3D 重建）

---

## 2. 许可证格局（对 Glaux 至关重要）

| 层级 | 数据集 | 对 Glaux 的含义 |
| --- | --- | --- |
| **全开放（CC0 / CC BY）** | HC18、CUBS、PSFHS、BUS-BRA、BrEaST、BUSI、Fetal Planes、Fetal Abdominal、MicroSegNet | 评测**和**训练/发行都可用 |
| **非商用（CC BY-NC / NC-SA / NC-ND）** | CAMUS、ACOUSLIC-AI、EchoNet 全家、Stanford Thyroid、MITEA、Unity、Open Kidney | **评测/外部验证/校准通常可用**；训练并随产品发行不可（需单独授权） |
| **需签 DUA / 联系作者** | BUSIS、TRUSTED、ICLUS、UDIAT | 有门槛、周期长；能否商用需逐个谈 |

> **关键**：Glaux **集成现成模型、不自研分割器**（[需求 §3.2](../requirements.zh-CN.md)），首要用途是**评测与外部验证**——**这把大多数 NC 集也纳入可用范围**，显著扩宽选择。真正被 NC 卡住的只有"用其数据训练并发行"。

---

## 3. 超声基础/分割模型格局（集成而非自研）

- **别自研分割器**——集成现成的：
  - **UltraSam**（2024，US-43d 训练）：最"超声原生"的 SAM 式模型，point/box 提示；其 ViT 骨干下游胜过 ImageNet/SAM/MedSAM 初始化 · [arXiv](https://arxiv.org/pdf/2411.16222)
  - **SAMUS / CC-SAM**（MICCAI/ECCV 2024）：为超声低对比/散斑改造 SAM；CAMUS-LV Dice ~91–93、BUSI ~85–86
  - **USFM**（Fudan，~219 万图自监督）：标签高效，20% 标注即可比肩全量 · [GitHub](https://github.com/openmedlab/USFM)
  - **MedSAM2**（2025，3D+视频）：含 ~1.9 万超声帧；echo 视频用户研究 · [site](https://medsam2.github.io)
  - **EchoCLIP / EchoPrime**：超声心动视觉-语言基础模型
- **基线用 nnU-Net**：多数论文的强全监督基线（CAMUS ~94% Dice），SAM 系正是在"用更少标注追平它"。
- ⚠️ **香草 SAM 在超声上是所有模态里最差的**（扇形视野/散斑/低对比），必须用超声适配版。
- **信号（利好方向）**：2025–26 出现**文本提示的超声分割**（Grounding DINO-US-SAM、UniUltra/SAM2）——正是 Glaux 的目标交互,说明 NL 驱动方向被验证,而非需从零训练。

---

## 4. 短名单与推荐（核心交付）

按"掩膜 + 测量端点 + 多中心 + 许可证 + 规模 + 非专家真实需求"综合打分：

### 🥇 首选：胎儿生物测量（HC18 启动 + ACOUSLIC-AI 外验）
- **HC18** 做**启动 demo**：最干净的 segment→measure（分割头→椭圆→HC mm），全开放、简单、临床即时可懂、有活跃榜。**唯一硬伤：单中心**。
- **ACOUSLIC-AI** 做**多中心外部验证伙伴**：掩膜 + AC 测量,真·多国(塞拉利昂/坦桑尼亚/荷兰),自带低资源泛化叙事。
- 取舍:ACOUSLIC-AI 是 **CC BY-NC-SA**(评测可用,发行训练不可)、视频盲扫格式工程量大、v1.0 有测量 bug(已在 v1.1 修——**是"连挑战赛金标准也会有 QA bug"的现成佐证**,写进验证层叙事)。

### 🐎 强力黑马:CUBS(颈动脉 IMT)
- 公开集里**唯一同时**多中心(2 院)+ **全开放(CC BY 4.0)** + 直接 mm 测量(IMT);还带 3 专家 + 5 算法参考分割(现成的"多方法一致性"素材)和长期心血管结局(强动机故事)。
- 取舍:解剖较窄(仅远壁 CCA)、作为"首秀"不如胎儿/心脏抓眼球。**但对"外部验证 + 全开放"这条我们最看重的线,它是最优单一数据集。**

### 🥈 认知度选项:CAMUS(心脏 LV→EF)
- EF 家喻户晓、认知度最高、可直接下载、故意含低质图(利于鲁棒性叙事)。取舍:单中心单厂商、需引用/非商用式,跨中心得配 EchoNet(不同中心,但 GT 是描迹非全掩膜)。

**其余强项备选**:PSFHS/IUGC(CC BY 4.0、多中心增长快、掩膜+角度测量)、BUS-BRA(乳腺、CC BY、活检确诊)、BUSIS(乳腺真多中心但 DUA)。

---

## 5. 注意事项(caveats)

- **单中心/单厂商、无原生跨中心划分**:HC18、BUSI、UDIAT、CAMUS、EchoNet-Dynamic/Pediatric、TN3K、DDTI、Stanford Thyroid、MicroSegNet、Kaggle 神经 —— 要做外部验证须**自己拼装**跨中心集。
- **已知标签质量问题**:BUSI(19% 重复/8% 错部位/大量叠加)、ACOUSLIC-AI v1.0(AC 算错,已修 v1.1)、Kaggle 神经(~60% 空掩膜、标签噪声)、CAMUS(19% 低质图,是特性也是坑)、DDTI(多版本图数不一致)。
- **仅分类/评分、无测量端点**:POCUS、ICLUS(肺)、Fetal Planes、TMED(主动脉瓣)。
- **公开空白**:肝(纤维化/脂肪变)、肌骨、颈动脉斑块、核透明度(NT)——只有机构私有数据。
- **访问门槛**:UDIAT(仅邮件)、BUSIS/TRUSTED/ICLUS(需 DUA)、Stanford/EchoNet(注册 + 非商用,商用费用可观)。

---

## 6. 对 Glaux 的战略启示 + 开放问题

**启示**
1. **"多中心 + 测量 + 全开放"三满足的集极少**——这印证了纲领:外部验证/校准这层公开世界给不全,**正是验证层护城河的机会**;Glaux 常需**自己拼装跨中心验证集**(如 HC18 + ACOUSLIC-AI/PSFHS,或 CAMUS + EchoNet)。
2. **许可证按"评测 vs 训练发行"分层**:因为我们**集成不自研**,主要用途是评测/外验/校准,NC 集大多可用——选择面比表面宽。
3. **文本提示超声分割(2025–26)正在出现**——NL 驱动方向被业界验证,Glaux 不必从零训练,集成 + 编排 + 验证才是差异化。
4. **现成的"验证层素材"**:CUBS 的多方法参考分割、ACOUSLIC-AI 的 QA bug 案例——都可直接喂给"多方法一致性 / 校准不确定"的叙事与实现。

**开放问题 / 下一步(需拍板)**
- **选哪个解剖做首个楔子?** 我的排序:胎儿生物测量(demo 强、需求广)≈ CUBS/颈动脉(外验+全开放最优),CAMUS/心脏(认知度)。
- **具体任务端点**:如"HC18:分割胎头→头围 mm"或"CUBS:分割内中膜→IMT mm"——建议**先锁一个**跑通闭环。
- **首个真实 B 是谁**:胎儿超声(产科研究者)vs 颈动脉(心血管流行病学研究者)vs 心脏(超声心动研究者)——不同解剖对应不同 B,反过来也可帮定解剖。
- 商用许可证边界(若未来要用 NC 集训练/发行)需逐个复核。

---

## 来源(节选)

- HC18:[grand-challenge](https://hc18.grand-challenge.org/) · [Zenodo](https://zenodo.org/records/1327317) · [van den Heuvel 2018 PLoS ONE](https://pmc.ncbi.nlm.nih.gov/articles/PMC7887128/)
- ACOUSLIC-AI:[challenge](https://acouslic-ai.grand-challenge.org/) · [Zenodo](https://zenodo.org/records/12697994) · [Med Image Anal 2025](https://www.sciencedirect.com/science/article/pii/S1361841525001872)
- PSFHS/IUGC:[Zenodo](https://zenodo.org/records/10969427) · [Sci Data 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11066050/) · [challenge report arXiv](https://arxiv.org/abs/2409.10980)
- CAMUS:[下载](https://humanheart-project.creatis.insa-lyon.fr/database/) · Leclerc 2019 IEEE TMI
- EchoNet:[Dynamic](https://echonet.github.io/dynamic/) · [LVH](https://echonet.github.io/lvh/) · [AIMI](https://aimi.stanford.edu/datasets/echonet-dynamic-cardiac-ultrasound)
- Unity Imaging:[data.unityimaging.net](https://data.unityimaging.net/)
- CUBS:[Mendeley](https://data.mendeley.com/datasets/fpv535fss7/1) · Ultrasound Med Biol 2021
- 乳腺:[BUSI](https://www.kaggle.com/datasets/aryashah2k/breast-ultrasound-images-dataset) · [BUS-BRA Zenodo](https://zenodo.org/records/8231412) · [BrEaST TCIA](https://www.cancerimagingarchive.net/collection/breast-lesions-usg/) · BUSI 质量问题 Pons et al. PMC10293973
- 甲状腺:[TN3K/TG3K GitHub](https://github.com/haifangong/TRFE-Net-for-thyroid-nodule-segmentation) · [Stanford Thyroid Cine](https://stanfordaimi.azurewebsites.net/datasets/a72f2b02-7b53-4c5d-963c-d7253220bfd5)
- 前列腺/肾:[MicroSegNet Zenodo](https://zenodo.org/records/10475293) · [Open Kidney](https://github.com/rsingla92/kidneyUS) · [TRUSTED Sci Data 2025](https://www.nature.com/articles/s41597-025-04467-1)
- 基础模型:[UltraSam](https://arxiv.org/pdf/2411.16222) · [SAMUS](https://ar5iv.labs.arxiv.org/html/2309.06824) · [USFM](https://arxiv.org/pdf/2401.00153) · [MedSAM2](https://medsam2.github.io) · [EchoPrime](https://arxiv.org/abs/2410.09704)

## 变更记录
- **2026-07-05**：v1。5 路并行调研(乳腺/甲状腺、心脏/肺/神经、胎儿产科、前列腺/腹部/血管、通用挑战赛+基础模型)汇编;给出短名单与"胎儿生物测量 / CUBS"双推荐。
