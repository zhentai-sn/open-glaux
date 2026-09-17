---
kind: record
status: open
title: "review: 全仓技术债审计（v0.1.0 基线）"
type: review
created: 2026-08-27
scope: 全仓 backend / agent-runtime / frontend / science-core（38,241 行 / 281 文件），基线 `e7582c6`(v0.1.0)
---

# 全仓技术债审计 · v0.1.0 基线

> **用途**：v0.1.0 发布后的一次全仓技术债盘点——识别、分类、按可执行性定优先级，并给出可与特性开发并行的分期偿还计划。
> **日期**：2026-08-26 执行，2026-08-27 归档。
> **触发**：维护者要求「审查代码，找到技术债」。非阶段收口，是一次横切全仓的主动体检。
> **方法**：**实测优先，不靠静态阅读推断**。四套测试套件按各自文档命令实跑；关键结论在 `git worktree --detach e7582c6` 的干净检出上复现，以排除未提交改动干扰；缓存、数据污染等结论用运行期探针（`cache_info()`、文件字节数）确认。临时 worktree 与探针脚本已清理，工作区回到审查前状态。
> **半衰期提醒**：下方 file:line 定位于 `e7582c6` + 当时工作区（39 项未提交改动）；后续提交会漂移，动手前先确认现状。评分是审查当日的判断，不是永久属性。

## 一页纸

**最要紧的一条：后端 175 个用例自 2026-08-17 起从未真正运行过，v0.1.0 就是这么发出去的。**

`backend/tests/conftest.py:14` 在 `app.config` 之前 import 了 `app.dataset`，而 `glaux_core` 上 `sys.path` 的唯一途径正是 `config.py` 里那句 `sys.path.insert`。pytest 连收集阶段都过不去——不是某个用例红，是整个套件根本没跑。补一行 import 后：`156 passed · 19 skipped · 3 failed`，而那 3 条红灯全部指向另一条独立的债（D4，联调脚手架污染了真实科研数据集）。

这一切能活 9 天并随版本发布出去，根因是 **仓库没有任何 CI、git hook 或 pre-commit**（D2）：`make test` / `make lint` 都写好了，但没有任何东西会自动调用它们。

**整体判断：代码本身纪律很好，欠账集中在「验证与流程」层。** 约 23,000 行 TypeScript 里 `any` 0 处、`@ts-ignore` 0 处；38,241 行里 TODO 类标记一共 5 处；裸 `except:` 0 处。清单之所以只有 12 条，原因在此。真正需要警惕的是：**代码质量靠的是人的纪律，而纪律没有被任何自动化固化下来**——D1 就是纪律偶尔失手时，没有任何东西接住它的证明。

架构层有两条影响大但**不建议现在动**的债（D6/D7，模态抽象与数据源注册表各自只落地一半），理由见第四节。

## 一、评分方法

沿用通行的技术债定价：

```
优先级 = (影响 + 风险) × (6 − 成本)
```

三项均为 1–5。**成本取反**，使「便宜且有效」的条目自然浮到顶部——这也是为什么 D7 影响 4 却排在末位：它值得做，但不值得现在做。

- **影响**：拖慢日常开发的程度。
- **风险**：不修的后果严重性。
- **成本**：修复难度（5 = 最难）。

## 二、清单总览

| 档 | ID | 债务 | 类型 | 影响 | 风险 | 成本 | 分数 |
| --- | --- | --- | --- | :-: | :-: | :-: | :-: |
| P0 | D1 | 后端测试套件无法收集 | 测试 | 5 | 5 | 1 | **50** |
| P0 | D2 | 无任何 CI / pre-commit | 基础设施 | 4 | 5 | 2 | **36** |
| P0 | D3 | `make test` 漏掉 science-core 的 169 例 | 测试 | 3 | 4 | 1 | **35** |
| P0 | D4 | 联调脚手架污染真实 CUBS 数据集 | 代码/数据 | 3 | 4 | 1 | **35** |
| P1 | D5 | `list_ids()` 缓存无失效路径 | 代码/潜在缺陷 | 3 | 3 | 2 | **24** |
| P1 | D9 | 无覆盖率度量，lint 规则集偏窄 | 工具 | 2 | 3 | 2 | **20** |
| P1 | D10 | 运维知识只活在未跟踪脚本里 | 文档 | 3 | 2 | 2 | **20** |
| P1 | D12 | backend venv 内并存两个 Python 版本 | 依赖 | 2 | 2 | 1 | **20** |
| P1 | D8 | SSRF 守卫双语言实现，无共享向量 | 架构/安全 | 2 | 4 | 3 | **18** |
| P2 | D6 | `datasource_registry` 抽象只落地一半 | 架构 | 4 | 3 | 4 | **14** |
| P2 | D11 | 8 份 SDD 全部停在 `implemented` | 流程 | 2 | 2 | 3 | **12** |
| P2 | D7 | 模态不是一等抽象，而是散落的 if 阶梯 | 架构 | 4 | 3 | 5 | **7** |

## 三、发现明细

### P0 · D1 后端测试套件无法收集（测试债 · 50）

`backend/tests/conftest.py:14` 假设有人已先导入 `app.config`，而在 pytest 下没有人：

```
$ cd backend && uv run pytest -q
ImportError while loading conftest '.../backend/tests/conftest.py'
tests/conftest.py:14: in <module>
    from app import dataset, dataset_ct, dataset_wsi, hc_real, hc_synth
app/dataset.py:13: in <module>
    from glaux_core.io.boundaries import Boundary
E   ModuleNotFoundError: No module named 'glaux_core'
```

在 `e7582c6`(v0.1.0) 的干净 worktree 上同样复现，**与当前未提交改动无关**。这条债由 `f77090c`（2026-08-17，一个补 conftest 清空 lru_cache 的提交）带进来——讽刺的是那次提交本意正是修复用例间的缓存串用。

**根因不在 conftest，在 `app/dataset.py` 自己**：它第 13 行 import `glaux_core`、第 18 行才 import `config`，等于把 `sys.path` 装配责任推给调用方。`app/__init__.py` 不导入 config，`glaux_core` 也没装进 venv（`uv pip install -e ".[dev]"` 不含它），所以装配完全依赖导入顺序。

**建议**：短期在 `conftest.py` 顶部先 `from app import config`（已验证：`156 passed · 19 skipped · 3 failed`）。根治二选一——把 `sys.path` 装配移进 `app/__init__.py`，或 `uv pip install -e ../science-core` 让它成为真依赖。

### P0 · D2 无任何自动化验证（基础设施债 · 36）

`.github/workflows` / `.gitlab-ci.yml` / `.pre-commit-config.yaml` 均不存在，`.git/hooks` 下无非 sample 文件。`make test` 与 `make lint` 都写好了，但没有任何东西会自动调用。

这是 D1 能活 9 天并随 v0.1.0 发布出去的**直接原因**，也是 D3、D4 得以长期潜伏的原因。

**建议**：一个 workflow 即可——四个 job 并行跑 `make test-backend` / `test-frontend` / `test-agent-runtime` / `test-science-core`，外加 `make lint`，设为 PR 门禁。依赖真实数据集的用例本就 skip（19 条），CI 上无需数据。

> 补充（2026-08-31）：托管平台确认为 **GitHub**，落点是 `.github/workflows/`。维护者本轮决定**后置**此条，不与第 0 期同批做。`test-science-core` 已随 D3 就位，CI 建起来时四个 test 目标可直接用。

### P0 · D3 `make test` 漏掉 science-core 的 169 个用例（测试债 · 35）

`grep -c 'science-core' Makefile` → **0**。Makefile 完全没提过这个模块。

```
$ cd science-core && uv run pytest -q
169 passed in 0.63s
```

这 169 条全绿，但绿只是因为最近没人动那部分——没有任何流程会告诉你它们红了。而 science-core 恰恰是测量与分割的**算法真相源**。

**建议**：Makefile 加 `test-science-core` 目标并挂进 `test` 依赖链。0.63 秒，没有理由不跑。

### P0 · D4 联调脚手架把自然图写进真实 CUBS 科研数据集（代码/数据债 · 35）

未跟踪的 `install-natural.sh` 把猫与咖啡的照片，以 `tech_0450.tiff` / `tech_0451.tiff` 的名字写进了真实颈动脉超声数据目录。前导零是刻意的——`int("0450")=450` 落在默认演示区间 401–500 内，且在 `sorted()` 里排到 `tech_401` 之前，以挤进侧栏可见的前 14 个。

代价是它们现在被当作颈动脉超声图列出，并在 D1 修好后直接打红 3 个用例：

```
test_real_dataset_cohort            → assert 102 == 100   # tech_401–500 演示队列
test_task_run_unified_imt_shape     → 503 "caroSegDeep 现算未产出 tech_0450"
test_real_segment_caro_and_reference → 同源

$ ls ~/glaux_datasets/.../DATASET_CUBS_tech/images/
tech_0450.tiff  2,989,196 B   ← 猫
tech_0451.tiff  2,546,828 B   ← 咖啡
```

**这个 hack 已经过时了**：[SDD 07](../sdd/feats/07-natural-image-sam-demo/README.md) 落地的 `backend/app/dataset_natural.py`（`natural_*` 前缀 + `modality=natural_image` + 固定 ID→文件名白名单）才是正路，且写得干净——固定映射本身就是路径安全边界。

**建议**：删掉这两个 tiff 与 `install-natural.sh`。旧路子留着只会继续污染数据和测试。

### P1 · D5 `list_ids()` 的缓存没有任何失效路径（代码债/潜在缺陷 · 24）

`backend/app/dataset.py:34` 挂着 `@lru_cache(maxsize=1)`，而全仓 `backend/app/` 里一次 `cache_clear()` 都没有。同时 `POST /datasources` 与 `DELETE /datasources/{id}` 允许运行期增删数据源。两件事凑在一起：**进程活着时，磁盘上的变化对 `/images` 不可见**。

```
>>> dataset.list_ids.cache_info()
CacheInfo(hits=1, misses=1, maxsize=1, currsize=1)
```

`restart-backend.sh` 的第 2 行注释已经把这条债写在脸上：「只重启 backend(list_ids 有 lru_cache,新图要重启才扫得到)」。同类还有 `hc_real._ds()`（`hc_real.py:34`）。

**建议**：最小改动是 `register_folder` / `remove` 成功后调 `list_ids.cache_clear()`。更彻底的做法见 D6——若 `dataset.py` 改走 `resolve_root()`（实时读），这条债自然消失。

### P1 · D9 无覆盖率度量，lint 规则集偏窄（工具债 · 20）

三端均无覆盖率配置，因此「测试债」目前没有任何量化抓手。

- `backend/pyproject.toml`：`select = ["E","F","I","W","UP"]`——没有 `B`（bugbear，可抓可变默认参数、循环变量绑定等真 bug），没有 `S`（安全）。
- `agent-runtime/package.json`：`"lint": "npm run typecheck"`，即 lint 只是 typecheck 的别名，无 ESLint。
- frontend 有 ESLint + `tsc -b`，是三者中最完整的。

**建议**：Ruff 加 `B`、`S`（先跑一遍看基线噪音，必要时逐条 `noqa` 并写明理由）；vitest 与 pytest 都自带覆盖率，先只采集不设门禁，攒两周基线再定阈值。

### P1 · D10 运维知识只活在未跟踪的 shell 脚本里（文档债 · 20）

根目录有 5 个未进 git 的 `.sh`，均写死 `~/code/pre-tech/open-glaux`，其中一个还从 `~/.bashrc` grep `GITEE_AI_TOKEN`：

| 脚本 | 编码的知识 |
| --- | --- |
| `run-backend.sh` | `GLAUX_DEMO_HI=999` 放宽演示区间 |
| `run-agent-runtime.sh` | `GLAUX_SEG_API_TOKEN` + `GLAUX_ANNOT_ALLOW_EGRESS=1`，否则 `segment_region` 不注册 |
| `restart-backend.sh` | lru_cache 绕过（见 D5） |
| `health.sh` | 三端探活 + 从 `/proc/<pid>/environ` 核查门控变量 |
| `install-natural.sh` | **已被 SDD 07 取代，见 D4** |

这些是 Makefile 和文档里都没有的真知识。换台机器、换个人，全部丢失。

**建议**：`health.sh` 与 `run-*.sh` 收进 `scripts/dev/` 并入库——绝对路径换成相对仓库根，token 改为从环境读而非扒 `.bashrc`。`install-natural.sh` 直接删。

### P1 · D12 backend venv 内并存两个 Python 版本（依赖债 · 20）

```
$ ls backend/.venv/lib/          → python3.12  python3.13
$ backend/.venv/bin/python -V    → Python 3.12.3
pyproject: requires-python = ">=3.10"   Makefile: uv venv --python 3.12
```

这种状态下「装了什么」取决于当时用的哪个解释器，是「在我机器上是好的」的典型温床。

**建议**：`rm -rf backend/.venv && make install-backend`。顺手把 `requires-python` 收紧到 `>=3.12`——既然实际只在 3.12 上验证过，声明支持 3.10 是没有依据的承诺。

### P1 · D8 SSRF 守卫在两种语言里各写了一遍（架构/安全债 · 18）

同一套出站策略——同样的环境变量（`GLAUX_VLM_HOST_ALLOW` / `GLAUX_VLM_ALLOW_FAKEIP`）、同样的 fake-ip 网段（198.18.0.0/15）、连报错文案都一样——在两处独立实现：

| 实现 | 行数 | 测试 |
| --- | --- | --- |
| `backend/app/net_guard.py` | 135 | `backend/tests/test_net_guard.py` 99 行 |
| `agent-runtime/src/security/net-guard.ts` | 206 | `agent-runtime/tests/security/net-guard.test.ts` 150 行 |

**共享 fixture / 黄金向量文件：无。** 两边现在是对齐的（本次逐行比对确认），但对齐靠的是人的记性。安全边界靠记性维护，是迟早要还的债。

已存在一处**有意差异**，但未写进任何文档：Python 有 `allow_plain_http`（Atlas 网页导入需要，只读抓取不带凭据），TS 没有。

**建议**：抽一份 `docs/contracts/egress-vectors.json`，每条记录 `{url, resolvedIps, env, expect}`，两侧测试各自读它跑参数化用例；有意差异在向量里显式标注。这样策略漂移会在测试里立刻现形。仓库已有现成范式——`scripts/version_matrix.py --check` 就是一条跨服务一致性门禁。

### P2 · D6 `datasource_registry` 抽象只落地了一半（架构债 · 14）

```
$ grep -c 'datasource_registry' backend/app/dataset*.py backend/app/hc_dataset.py
dataset_ct.py        1   ✓ 注册表驱动（dataset_ct.py:63）
dataset_wsi.py       1   ✓ 注册表驱动（dataset_wsi.py:36）
dataset.py           0   ✗ 默认模态，读死 config.IMAGES_DIR
dataset_natural.py   0   ✗
hc_dataset.py        0   ✗
```

CT 与 WSI 通过 `reg.resolve_root()` 拿数据根，运行期导入的源对它们有效；颈动脉（**默认模态**）、自然图、HC 三个模块压根不认识注册表，直接读 `config.*` 常量。结果：`POST /datasources` 导入一个颈动脉目录，它会出现在 `/datasources` 列表里，但 `/images` 永远不会从那里取图。

`resolve_root` 自己的 docstring 也承认了另一半——「首个 active 源的 root（多源选择是后续，见计划 §5）」，即内置源先 seed，只要它有数据就会永久遮蔽导入源。

**建议**：让 `dataset.py` 也走 `resolve_root("carotid_imt")`，与 CT/WSI 对齐（顺带天然解决 D5）。多源选择是更大的题，可继续押后；但「一半模态认注册表、一半不认」这个状态本身要收敛。

### P2 · D11 8 份 SDD 全部停在 `implemented`，无一 `accepted`（流程债 · 12）

按 SDD 方法论生命周期是 `draft → ready → implemented → accepted`。8/8 卡在倒数第二格，说明验收这一步是被**系统性跳过**的，而非某一份忘了推进。

`accepted` 恰恰是「我验过它真的按规范工作了」的那一格——也正是 D1 这类问题本该被拦住的地方。

**建议**：别追认历史。给 `accepted` 定一条最低门槛（如「CI 绿 + 验收清单逐条勾过」），从下一份 SDD 开始执行；老的 8 份等各自下次被改动时顺手补。

### P2 · D7 模态不是一等抽象，而是散落各处的 if 阶梯（架构债 · 7）

五值联合类型在三处**手工同步**，无 codegen：

- `frontend/src/api/types.ts:4` — `Modality = "carotid_imt" | "fetal_hc" | "ct_abdomen" | "pathology" | "natural_image"`
- `backend/app/schemas.py:17` — 同名 `Literal[...]`
- `agent-runtime/src/contracts.ts`

前端 **20 个文件**按模态分支（`data/actions.ts` 28 处、`VolumeViewer` 13、`WsiViewer` 11、`SideBar` 11）；路由层在 `/images` 与 `/image` 各有一条阶梯。更麻烦的是**判别方式有三种**：

| 端点 | 判别方式 |
| --- | --- |
| `/images` | `modality` 查询参数 |
| `/image` | `image_id.startswith("natural_")` — ID 前缀 |
| 同上 | `hc_dataset.is_hc()` / `dataset_ct.is_ct()` — 谓词 |

同一个概念，三套约定。加第六个模态大约要动 25 处。

**建议：先别重构。** 成本 5、影响 4，在只有五个模态、单数据源的现实下造抽象层，是拿确定的成本换不确定的收益。**现在只止血**：从后端 OpenAPI 生成前端类型（消掉三份手抄件，这一步便宜且独立），并约定新模态一律走 `modality` 参数、不再新增前缀或谓词判别。真正的模态注册表，等第六个模态来了、需求逼着做的时候再做。

## 四、分期偿还计划

分期依据是「什么时候做最省」，不是「什么最严重」。**第 0 期必须先做完**——在测试跑不起来的前提下做任何其他改动，都是在没有安全网的情况下施工。

### 第 0 期 · 立刻（约 1 小时）

| 条目 | 动作 | 预估 |
| --- | --- | --- |
| D1 | 修 `conftest.py` import 顺序，确认 156 passed | 30 分钟 |
| D4 | 删 `tech_0450/0451.tiff` 与 `install-natural.sh`，确认 3 条红灯转绿 | 10 分钟 |
| D3 | Makefile 挂上 `test-science-core` | 10 分钟 |
| D12 | 重建 backend venv，收紧 `requires-python` | 15 分钟 |

做完这一期，`make test` **第一次**真正覆盖全部四个模块、约 660 个用例。此前它覆盖的是三个。

### 第 1 期 · 两周内（约 1.5 天）

- **D2** 建 CI：四个 job 跑 test + lint，设 PR 门禁 —— 半天
- **D9** Ruff 开 `B`/`S`，三端采集覆盖率（先不设门禁） —— 半天
- **D10** `run-*.sh` / `health.sh` 收进 `scripts/dev/` 并入库 —— 2 小时

第 0 期是修一次，第 1 期是让这类问题不再需要靠人肉审查才能被发现。D2 的价值不在它自己，而在于它把 D1、D3、D4 变成不可能重犯。

### 第 2 期 · 随特性推进（增量，有自然触发点）

- **D5** 下次动数据源相关代码时，补 `cache_clear()`
- **D8** 下次动出站策略时，先抽共享向量文件再改
- **D11** 从下一份 SDD 开始执行 `accepted` 门槛

专门排期做这三条性价比不高，但下次路过时不顺手做掉，就会一直躺着。

### 触发式 · 别提前做

- **D7** 现在只做 OpenAPI → 前端类型生成；模态注册表等第六个模态
- **D6** 现在只做 `dataset.py` 走 `resolve_root`（与 CT/WSI 对齐）；多源选择等真有多源需求

这两条是全清单影响最大的架构债，也是最容易被过早重构毁掉的。

## 五、健康的部分（确认无需改动）

技术债审查容易只报坏消息，那会给出失真的图景。本仓库在几个最容易腐坏的维度上纪律相当好——上面清单之所以短，原因就在这里。

- **TypeScript 零逃逸**：frontend + agent-runtime 约 23,000 行里，`any` 0 处、`@ts-ignore`/`@ts-expect-error` 0 处、空 `catch {}` 0 处。这个规模能守住，很少见。
- **几乎没有 TODO 坟场**：38,241 行里 TODO/FIXME/HACK 一共 5 处，且都写清了归属阶段（如 `carosegdeep.py:48` 标注「接线阶段」）。
- **宽泛捕获是有意的降级**：29 处 `except Exception` 中 24 处带行内理由注释（「science-core 不可用」「单张损坏图跳过」「解析失败一律视作拒绝」），裸 `except:` **0 处**。这是策略，不是偷懒。
- **路径安全边界清楚且写明**：`dataset_natural` 用固定 ID→文件名白名单而非路径拼接；`register_folder` 强制 `is_relative_to(datasets_root())` 校验防任意目录读。两处都在注释里声明了这是安全边界。
- **已有跨服务一致性门禁**：`scripts/version_matrix.py --check` 校验三端版本对齐并已挂进 `make test`——D8 想要的东西，这里有现成范式。
- **其余三套测试全绿且写得扎实**：agent-runtime 163、frontend 150、science-core 169，本次实跑全部通过；含并发会话隔离、幂等冲突等真集成用例。

## 六、结论

**代码本身是健康的，欠账集中在验证与流程层。** 12 条里 4 条 P0 加起来约 1 小时，却能把「改坏了会有人告诉我」这件事重新装回项目——这是本次审查的核心结论，也是唯一有紧迫性的部分。

D1 值得单独记一笔：它不是能力问题，是**没有安全网时纪律偶尔失手的必然结果**。一个本意为「补测试」的提交反而让全部后端测试静默停摆 9 天并随版本发布，恰好说明了 D2 的价值不在 CI 本身，而在于它让这类失手无法逃逸。

架构层的 D6/D7 影响最大但明确**不建议现在动**：在五个模态、单数据源的现实下，现在造抽象层是投机。二者都已给出低成本的止血动作，把真正的重构留给需求真正逼上门的那一天。

> 状态说明：本文件 `status: open` 表示 12 条均未处理。第 0 期完成后应回改本节并把已闭环条目标注为 done。

## 七、偿还进度

### 第 0 期 —— 已完成（2026-08-31）

| ID | 状态 | 落点 |
| --- | --- | --- |
| D1 | ✅ done | `conftest.py` 先导入 `app.config` 完成 `sys.path` 装配（`139d85a`）。**独立复现**：修 `make test-backend` 时自行诊断出同一根因，当时并不知道本文件已列为第一条——这本身佐证了 D2：审计写完归档了，没有任何机制会把它推到执行面前 |
| D3 | ✅ done | Makefile 新增 `test-science-core` 并挂进 `test` 依赖链；`make test` 首次覆盖四个模块 |
| D4 | ✅ done | 删除 `tech_0450/0451.tiff` 与对应 CF，删除 `install-natural.sh`；backend 由 `3 failed / 214 passed` 转为 `217 passed` |
| D12 | ✅ done | 重建 backend venv（只剩 `python3.12`），`requires-python` 由 `>=3.10` 收紧到 `>=3.12` |

第 0 期完成后 `make test` 实测：backend 217 · frontend 187 · agent-runtime 171 · science-core 169 · version 5，**全绿零失败**。

两条值得记下的执行细节：

1. **`install-natural.sh` 自带的回滚命令是危险的**：`rm $D/images/tech_045*.tiff $D/CF/tech_045*_CF.txt` 的通配会连真实的 `tech_045.tiff`（2018 年、灰度 800×600 的真实超声）一起删。实际清理按精确文件名执行，删后 `images/` 由 502 回到 500，真实数据完好。
2. **D4 的红灯曾被长期误读为环境问题**。审计归档后的第一轮特性开发里，那 3 条失败被反复记作「caroSegDeep 现算环境不可用」并写进了两份 SDD 的验收自查——包括用 `git stash` 跑基线"证明"与本次改动无关（结论对，归因错）。长期红灯会把人训练成忽略红灯，这正是 D4 优先级不低的真实原因。

### 第 2 期 —— D5 已提前偿还（2026-08-31）

| ID | 状态 | 落点 |
| --- | --- | --- |
| D5 | ✅ done | 新增 `backend/app/caches.py` 统一失效入口；`register_folder` / `remove` / `register_builtin_samples` 三处变更后调用。放独立模块是为了保住注册表「纯 stdlib + config」的定位（`caches` 会碰 `dataset`/`dataset_wsi` 等重依赖），注册表以函数内延迟导入调用 |

原计划挂在第 2 期「下次动数据源相关代码时顺手做」。SDD 08 把运行期增删源的入口从 2 个变成 4 个
（新增 `POST /uploads/images` 与 `POST /datasources/samples`），触发点已实打实踩满，故提前做掉。

失效范围不止 `dataset.list_ids`：`hc_real._ds`、`dataset_ct._load_nifti`、`dataset_wsi._open` /
`_deepzoom` 一并登记——最后两个持有 OpenSlide 句柄，源被删后还攥着已消失的文件。

`tests/test_cache_invalidation.py` 5 条。**已反向验证**：临时停用失效调用后 3 条转红，还原后全绿，
确认测试不是空转。首条用例专门先证明「缓存确实会挡住磁盘变化」，否则后面几条等于什么都没验。

### 尚未处理

D2（CI · 36，维护者本轮决定后置）、D9（覆盖率与 lint 规则集 · 20）、D10（部分完成：四个 `run-*.sh` /
`health.sh` 已随 `d14190d` 入库，尚未移进 `scripts/dev/`，绝对路径仍写死）、D8、D6、D11、D7。

D2 仍是剩余项里分数最高的一条——第 0 期是修一次，D2 才是让 D1/D3/D4 不可能重犯。
