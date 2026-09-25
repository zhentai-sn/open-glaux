---
kind: record
status: done
---

# 体育视频评测集调研：数据可得性与选型

> **用途**：为视频理解 harness 找可复现的体育评测集，并选定首批两个。
> **日期**：2026-09-25 · **类别**：research（科研）
> **依据**：[篮球视频理解基准调研](20260925-01-research-basketball-video-benchmark.zh-CN.md) · [SDD 11 视频理解 harness](../sdd/feats/11-video-understanding-harness/README.md) D-15
> **后续**：[视频评测计划：TennisTV 与 BARD](../plans/2026-09-25-video-eval-tennistv-bard-plan.md)
> **半衰期提醒**：数据集发布状态和 NBA 接口会变化；「已验证」项为 2026-09-25 实测，其余来自论文和仓库页面。

---

## 0. 结论

- BasketballBench 的视频、题目和标准答案都没有公开，不能复现。
- NBA 官方回合片段在技术上可以抓取，但题目和标准答案要自己标注，而且只能内部使用。
- 选定 **TennisTV**（网球）和 **BARD**（篮球）作为首批评测集：两者都不用审批，可以马上开始。
  - TennisTV 的题目现成可用，其中 MGG 类可以直接评时间证据。
  - BARD 的片段带原声，可以评音频的作用；但没有时间戳，也没有问答，需要自己转换。
- 未选：SportsTime（需审批约一周）、RefereeBench（发布状态未核实）、SoccerNet 系列（需签 NDA）。

## 1. NBA 官方视频的可得性

| 项 | 结论 |
| --- | --- |
| 回合片段 | 非公开接口 `stats.nba.com/stats/videoeventsasset` 返回 uuid，可拼出 `videos.nba.com` 的 720p mp4 直链；每段 5～15 秒；2025-26 赛季仍可用 |
| 限制 | 需带 `Origin`、`Referer` 和浏览器 UA；云主机 IP 有被屏蔽的报告；有限流，需家用网络低速抓取 |
| 逐回合数据 | nba_api `PlayByPlayV3`（V2 已返回空数据）；shufinskiy/nba_data 覆盖到 2024-25 |
| 整场录像 | 无合法下载途径；League Pass 只提供流媒体 |
| 许可 | NBA.com 条款只允许私人非商业使用，禁止再分发；学术惯例是只发布 GameID/EventID、标注和下载脚本 |
| 工作量 | 抓取成本低；主要成本是人工标注题目和时间戳 |

来源：[NSVA 下载脚本](https://github.com/jackwu502/NSVA)、[nba_api issue #498](https://github.com/swar/nba_api/issues/498)、[NBA.com 使用条款](https://www.nba.com/termsofuse)、[shufinskiy/nba_data](https://github.com/shufinskiy/nba_data)。

## 2. 候选评测集

「未核实」指来源页面没有写明。

| 数据集 | 任务 | 规模 | 时间戳金标准 | 视频获取 | 原声 | 许可 |
| --- | --- | --- | --- | --- | --- | --- |
| [SportsTime](https://github.com/ustiniansy/SportsTime)（ECCV'26） | 开放式问答 + 逐步时间证据 | 5 项运动，1,575 个视频，14,326 题 | 有 | Hugging Face 审批制，734 GB | 未核实 | CC BY-NC 4.0 |
| [TennisTV](https://modelscope.cn/datasets/FDUBay/TennisTV)（ICASSP'26） | 多选问答，8 类任务 | 2,527 题 | MGG 类有 | 题目公开；视频按 F3Set 清单从 YouTube 下载 | 原片带原声 | 未注明 |
| [BARD](https://huggingface.co/datasets/GabrieleGiudici/BARD)（CVIU'26） | 片段级多标签动作描述 | 60 场 NBA，14,676 段 | 无 | Hugging Face 直接下载 | 有 | CC BY 4.0 |
| RefereeBench（2026） | 判罚问答，含时间定位 | 11 项运动，6,475 题 | 有 | 未核实 | 有；加音频准确率提升 15～16 个百分点 | 未核实 |
| [SoccerBench](https://huggingface.co/datasets/Homie0609/SoccerBench)（MM'25） | 多选问答，14 类 | 约 1 万题 | 未核实 | Hugging Face 直接下载 | 未核实 | CC BY-NC-SA 4.0 |
| TennisVL（2026） | 解说生成 | 472 小时 | 回合级 | Google Drive | 有，含对齐转写 | 未核实 |
| SoccerNet 系列、SoccerReplay-1988 | 事件定位、解说、犯规 | 500+ 场全场 | 有 | 签 NDA，审核 2～3 周 | 有 | 视频受 NDA 约束 |
| Sports-QA、SPORTU | 问答 | 9.4 万 / 1.2 万题 | 无 | 直接下载 | 未核实 | 未核实 |

## 3. 选定两个数据集的实测

### 3.1 TennisTV

- 题目文件：ModelScope `FDUBay/TennisTV` 的 `benchmark/*.json`，共 8 个文件、约 790 KB，不用审批。
- 字段：`video`、`Question`、`Option`、`Answer`。`video` 的格式是 `<比赛名>_<起始帧>_<结束帧>`，指一个回合。

| 任务 | 题数 | 源比赛数 | 示例 |
| --- | --- | --- | --- |
| AR | 325 | 23 | 远端球员第一拍用了什么击球类型 |
| HD | 400 | 23 | 发球方向 |
| HO | 300 | 23 | 发球结果 |
| MGG | 180 | 62 | 某球员上网的时间段（五选一，选项为片段内秒数区间） |
| PWTF | 300 | 23 | 判断「远端球员赢得这一分」是否正确 |
| RC | 400 | 23 | 双方总击球次数 |
| TI | 300 | 23 | 哪位球员发球 |
| TPP | 322 | 23 | 近端球员的主要打法 |

- 合计 2,527 题、1,312 个回合片段、64 场源比赛。
- 回合长度中位数约 250 帧（25 fps 下约 10 秒），最长 1,095 帧（约 44 秒），在 SDD 11 的单次观察上限 60 秒以内。
- 视频来源：64 场比赛全部能在 [F3Set](https://github.com/F3Set/F3Set) 的 `data/f3set-tennis/videos.csv` 里查到 YouTube ID，标注为 1280×720、25 fps。F3Set 说明：下载不到的视频可以联系作者获取。
- 题目分布集中：题量最多的 3 场比赛共约 430 题，覆盖全部 8 类；MGG 分散在 62 场里。

### 3.2 BARD

- Hugging Face `GabrieleGiudici/BARD`，不用审批，CC BY 4.0，按比赛分目录存放 mp4。
- 抽查 `bkn-vs-det-0022400861/0.mp4` 和 `100.mp4`：H.264 1280 宽，**带 AAC 48 kHz 音轨**，时长 7.88 秒和 10.98 秒。
- 标注在 `captions/caption.json`：对话格式，答案是片段级动作描述（球衣号、球衣颜色、动作类型、结果、是否助攻），9 类动作。没有时间戳，也不是问答。

## 4. 选型理由

| 维度 | TennisTV | BARD |
| --- | --- | --- |
| 能评什么 | 答案正确率；MGG 类可评时间证据 | 答案正确率；音频的作用（带原声与静音对比） |
| 接入工作 | 下载 YouTube 原片并按帧切片 | 把动作描述转换成问答 |
| 风险 | 部分 YouTube 视频可能已失效；视频只能内部使用 | 只能评「做了什么」，评不了「什么时候」 |
