# Glaux 文档区

> Glaux 的调研、路线图等长期文档统一放在 `docs/` 下，按约定命名，便于检索、排序与引用。

## 目录结构

```
docs/
├── README.md              # 本文件：文档区导航与命名规约
├── architecture.zh-CN.md  # 仓库骨架总览：根目录各文件/目录、运行时全景、技术栈速查（活文档）
├── requirements.zh-CN.md  # 需求清单（初步 v0，活文档）
├── sdd/               # 规范驱动开发：Feature 边界、契约、状态机与验收
├── brainstorms/       # 脑暴 / 需求文档（按任务，right-sized）
├── researches/        # 调研报告（产品 / 市场 / 技术 / 科研）
├── designs/           # 架构 / UI 设计文档（带日期为记录，不带日期为活文档）
├── plans/             # 实现计划（按日期；承接 SDD/设计的 HOW）
├── runbooks/          # 操作手册（活文档：随代码同步修订）
├── todo/              # 代码评审与审计待办（按日期）
└── roadmaps/          # 路线图（按版本日期存档，根 README 指向当前版）
    └── charter.zh-CN.md  # 纲领：Glaux 的身份与一切决策的组织原则（先读这份）；路线图从纲领派生，故与路线图同属一族
```

## 文档类型：活文档与记录

所有文档分两类，以 frontmatter 的 `kind` 为准；未写 `kind` 时按下表的默认值处理。

- **活文档（`kind: living`）**：描述现状，是当前事实的唯一来源。
  - 只写最新结论，不写变更记录、修订历史；变化看 git log。
  - 与相关代码在同一提交里更新。
- **记录（`kind: record`）**：某个时间点的调研、决策或执行过程，用于追溯。
  - 进行中（如 `draft`、`active`、`open`）可以更新正文，例如勾选进度。
  - 进入终态后不改正文，只改 frontmatter 的 `status`、`superseded_by`。
  - 结论过时时，新结论写进活文档或新记录；旧记录 `status` 改为 `superseded`，并填 `superseded_by`。

### frontmatter

`docs/` 下的 Markdown 文档在开头写：

```yaml
---
kind: record                      # living | record
status: done                      # 取值见下表
superseded_by: docs/plans/…       # 从仓库根写起；仅 status 为 superseded 时填写
---
```

- 文档自身的 `kind`、`status` 以 frontmatter 为准；正文和索引表可以汇总列出，不一致时以 frontmatter 为准。
- 其他字段（如 `type`、`title`、`date`）可以保留。
- 用途、依据等说明按需写在 frontmatter 之后。
- 不写 frontmatter 的文件：
  - `docs/README.md` 和 `docs/*/README.md` 这类目录索引，按活文档处理。Feature SDD（`docs/sdd/feats/*/README.md`）不属于索引，要写。
  - `docs/` 之外的文件：`README*.md` 按活文档处理，`CHANGELOG.md` 按记录处理。
  - HTML、图片等非 Markdown 文件：`landing/` 按活文档处理，SDD 目录里的交互设计稿按记录处理。

### 各类文档的默认 kind 与 status

| 文档 | 位置 | kind | status |
| --- | --- | --- | --- |
| 纲领、仓库骨架总览、需求清单 | `roadmaps/charter.zh-CN.md`、`architecture.zh-CN.md`、`requirements.zh-CN.md` | living | `living` |
| SDD | `sdd/` | living | `draft` / `ready` / `implemented` / `accepted` |
| 操作手册 | `runbooks/` | living | `living` |
| 长期设计规范（不带日期） | `designs/` | living | `living` |
| 门户首页 | `landing/` | living | — |
| 调研 | `researches/` | record | `draft` / `review` / `done` / `superseded` |
| 脑暴 | `brainstorms/` | record | `idea` / `brainstorming` / `review` / `promoted` / `shelved` / `superseded` |
| 设计 | `designs/`（带日期）、`plans/*-design.md` | record | `draft` / `reviewed` / `implemented` / `superseded` |
| 实现计划 | `plans/` | record | `active` / `done` / `abandoned` / `superseded` |
| 代码评审与审计待办 | `todo/` | record | `open` / `closed` / `superseded` |
| 版本路线图 | `roadmaps/`（带日期） | record | `current` / `superseded` |

- SDD 与脑暴的状态定义见 [sdd/README.md](sdd/README.md)、[brainstorms/README.md](brainstorms/README.md)。
- 版本路线图的 `current` 只表示最新一版路线图，不代表实现现状。

## 当前发行工作

- [SDD 09 基本对话 Docker 发行包](sdd/feats/09-chat-distribution/README.md)
- [安装、运行与分发手册](runbooks/chat-distribution.md)

## 核心文档

- **[仓库骨架总览 · Architecture](architecture.zh-CN.md)** —— 根目录每个文件/目录的职责、三进程运行时全景、技术栈速查。**第一次接触仓库时先读这份。** 活文档，随结构演进更新。
- **[纲领 · Charter](roadmaps/charter.zh-CN.md)** —— Glaux 是什么、发展目标、决策过滤器、边界。**新成员 / 每次重大决策先读这份。** 它不随日期存档，是单一活文档，修订即更新——与 roadmaps/ 下按版本日期存档的其余文件不同，但同属路线图一族（路线图由纲领派生）。
- **[需求清单 · Requirements](requirements.zh-CN.md)** —— 初步需求（v0）：首个用户、场景、按环境四层的功能需求、成功标准与开放问题。活文档，随阶段 2 推进更新。
- **[SDD 索引](sdd/README.md)** —— 实现前冻结 Feature 范围、契约、状态机、错误处理与验收标准；仅 `ready` SDD 可进入实现规划。

## 一、调研 researches/

### 命名规约

```
<YYYYMMDD>-<NN>-<category>-<topic>.<lang>.md
```

| 段 | 含义 | 取值 |
| --- | --- | --- |
| `YYYYMMDD` | 调研完成日期 | 如 `20260705` |
| `NN` | 当日序号，2 位补零，从 `01` 起 | `01`、`02`… |
| `category` | 调研类别 | `product`（产品）· `market`（市场）· `tech`（技术）· `research`（科研） |
| `topic` | 调研主题，kebab-case，用英文 | 如 `competitive-landscape` |
| `lang` | 语言，可选；缺省视作 `zh-CN` | `zh-CN` · `en`（双语并存则并列两文件） |

**示例**：`20260705-01-market-competitive-landscape.zh-CN.md`

### 类别对照

- **product 产品** —— 产品形态、功能、定位、用户与需求。
- **market 市场** —— 竞争格局、竞品、商业模式、行业与监管趋势。
- **tech 技术** —— 技术选型、架构、模型、工程可行性。
- **research 科研** —— 学术前沿、论文、方法、科学问题本身。

### 现有调研

| 文件 | 日期 | 类别 | 主题 |
| --- | --- | --- | --- |
| [20260705-01-market-competitive-landscape.zh-CN.md](researches/20260705-01-market-competitive-landscape.zh-CN.md) | 2026-07-05 | market | 竞争格局与定位分析（含通用 agent 防御 / 护城河） |
| [20260705-02-research-ultrasound-benchmarks.zh-CN.md](researches/20260705-02-research-ultrasound-benchmarks.zh-CN.md) | 2026-07-05 | research | 公开超声图像基准调研（数据集 / 许可证 / 短名单推荐） |
| [20260816-01-tech-annotation-exemplar-store.zh-CN.md](researches/20260816-01-tech-annotation-exemplar-store.zh-CN.md) | 2026-08-16 | tech | 图像标注案例库技术调研（LanceDB / BiomedCLIP·DINOv2 / 检索增强分割；含已拍板决策） |
| [20260816-02-tech-deepseek-harness-integration.zh-CN.md](researches/20260816-02-tech-deepseek-harness-integration.zh-CN.md) | 2026-08-16 | tech | DeepSeek Harness 插件生态集成可行性（MCP Server / Cordis 插件 / Runtime 替换三路径；待评审） |

## 二、路线图 roadmaps/

### 命名规约

```
<YYYYMMDD>-<scope>-roadmap.<lang>.md
```

| 段 | 含义 | 取值 |
| --- | --- | --- |
| `YYYYMMDD` | 该版路线图定稿 / 更新日期 | 如 `20260705` |
| `scope` | 范围 | `product`（产品，默认）· `engineering`（工程）· `gtm` 等 |
| `lang` | 语言 | `zh-CN` · `en` |

**示例**：`20260705-product-roadmap.zh-CN.md`

### 约定

- 路线图**按版本日期存档**，不覆盖旧版——每次重大更新新建一份，保留演进痕迹。
- **根目录 README 指向"当前版本"**；每次发布新版路线图，同步更新两个根 README（`README.md` / `README.zh-CN.md`）的路线图段指向，并更新下方索引的"当前"标记。
- **例外**：`charter.zh-CN.md`（纲领）同属本目录，但不按日期存档、不建新版本——它是路线图的源头，单一活文档，修订即更新原文件。

### 现有路线图

| 文件 | 日期 | 范围 | 状态 |
| --- | --- | --- | --- |
| [charter.zh-CN.md](roadmaps/charter.zh-CN.md) | 活文档 | — | 纲领（路线图之源，不存档） |
| [20260705-product-roadmap.zh-CN.md](roadmaps/20260705-product-roadmap.zh-CN.md) | 2026-07-05 | product | ✅ 当前 |
| [20260818-frontend-quality-roadmap.zh-CN.md](roadmaps/20260818-frontend-quality-roadmap.zh-CN.md) | 2026-08-18 | frontend | `ready`（纲领落地：动效/无障碍/反馈打磨层） |

## 三、脑暴 brainstorms/

需求文档（脑暴产出），按任务/特性一份，供调研、SDD 或实现计划承接 HOW。

详见 **[brainstorms/README.md](brainstorms/README.md)**——含生命周期定义、需求跟踪表（状态与去向）、命名规约。

## 四、规范驱动开发 sdd/

Feature SDD 固定放在 `sdd/feats/<NN>-<name>/README.md`，统一记录状态、边界、输入输出、契约、生命周期、错误处理、验收与决策。

| Feature | 状态 | 主题 |
| --- | --- | --- |
| [00-reference-agent-conversations](sdd/feats/00-reference-agent-conversations/README.md) | `implemented` | 内置参考智能体与本地会话管理 |
| [01-dual-mode-shell](sdd/feats/01-dual-mode-shell/README.md) | `accepted` | 双模式外壳 Focus / Workbench |
| [02-agent-image-annotation](sdd/feats/02-agent-image-annotation/README.md) | `draft` | 智能体图像标注能力 |
| [03-atlas](sdd/feats/03-atlas/README.md) | `implemented`（v1.1 图册 + 右侧栏） | Atlas · 图谱（人工策展的图文案例库） |
| [04-unified-annotation-toolbox](sdd/feats/04-unified-annotation-toolbox/README.md) | `ready` | 统一图像标注工具箱（bbox/polygon/brush） |

## 通用约定

- 文件名一律小写，词间用连字符 `-`（kebab-case）；主题用英文 slug，便于跨系统与命令行处理。
- 文档正文可用中文；语言后缀标识正文语言，双语则并列两文件（`.zh-CN.md` / `.en.md`）。
- 一经共享 / 引用的文件**不要改名**（会断链）；要修订内容就改内容，要换版本就新建。
- `kind`、`status` 写在 frontmatter，见「文档类型：活文档与记录」。
