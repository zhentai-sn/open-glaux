---
kind: record
status: active
---

# SDD 14 项目文本文件预览与读取 · 实施计划

依据：[SDD 14](../sdd/feats/14-project-text-preview/README.md) 全文、D-1～D-9；上游修订见 SDD 14 §14。

## 现状要点

- `backend/app/routers/projects.py` 已有 `_project`、`_inside`、`_err` 与错误码表；新端点挂在同一 router，自动带回环守卫。
- `ProjectTree.FileLeaf` 对 `modality` 为空的条目渲染置灰的 `div`，不可点击。
- `StagePanel`（Focus）与 `Editor`（Workbench）各自按 `activeObject(s)` 决定显示查看器或占位；两处都要加文档覆盖层。
- `store/sessionWorkspaces.ts` 的 `Persisted` 只含 `{modality, focus}`；`saveWorkspace` / `restoreWorkspace` / 持久化函数三处需同步加 `document`。
- `AgentConversation.tsx` 以 `parseObjectOpened` + `ObjectCard` 渲染 `glaux.object_opened`；文件卡片按同一模式接入。
- `components/agent/Markdown.tsx` 只接收 `text`，未定制链接与图片；文档视图需要传入 `components` 覆盖 `a` 与 `img`，对话气泡保持现状。
- `harness-registry.ts` 的 `TOOL_PROVIDERS` 中 `list_files` 为 `requires: { project: true }`；`observe` 模式只保留视频工具，`read_file` 无需额外处理即不挂载。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | backend：文本判定与读取端点 | — | `GET /projects/{id}/text` 可用，单测覆盖 §15.1 |
| W2 | agent-runtime：`read_file` | 端点契约（SDD 14 §9.1），不依赖 W1 代码 | 工具挂载与输出格式单测通过 |
| W3 | frontend：文档视图、目录树、会话字段、文件卡片 | 端点契约，不依赖 W1 代码 | 前端单测通过，`vite build` 中 CodeMirror 为独立分块 |
| W4 | 活文档、§15 自查、浏览器走查、真实模型走查 | W1～W3 | SDD 14 转 `implemented` |

W1、W2、W3 改动互不重叠（分属三个目录），并行执行。

## W1 · backend

- `backend/app/textfile.py`（新）：
  - `detect_encoding(sample: bytes) -> str | None`：按 SDD 14 §7.1 规则 2 顺序判定；UTF-8 与 GB18030 用 `codecs.getincrementaldecoder(enc)(errors="strict").decode(sample, final=False)`，使样本末尾被截断的多字节序列不算失败；返回 `None` 表示二进制。
  - `read_lines(path, encoding, start_line, max_lines, max_bytes) -> TextSlice`：`open(path, encoding=..., errors="replace", newline=None)`，由通用换行模式把 `\r\n`、`\r` 统一为 `\n`。
  - 逐行读取一律用 `readline(limit)` 分块，单行不整行载入内存；跳过前 `start_line - 1` 行时同样分块。
  - 字节计数按 `len(line.encode("utf-8")) + 1`。已读至少一行后，下一行会超限即停止；本次第一行即超限时按字符边界截到 `max_bytes`，置 `line_truncated`，并跳过该行剩余部分。
  - 读到文件末尾时给出 `total_lines`（`start_line` 超出总行数时同样给出实际行数）。
- `backend/app/schemas.py`：`ProjectText`（SDD 14 §9.1 全部字段，`encoding` 用 `Literal`）。
- `backend/app/routers/projects.py`：
  - `_HTTP_BY_CODE` 增 `hidden_path: 422`、`binary: 422`。
  - `GET /{project_id}/text`：`path` 必填；`start_line: int = Query(1, ge=1)`、`max_lines: int | None = Query(None, ge=1, le=100000)`、`max_bytes: int = Query(1048576, ge=1, le=1048576)`。
  - 校验顺序：`_project` → 路径任一段以 `.` 开头 → `hidden_path` → `_inside` → 不存在 `not_found` → 非普通文件 `not_file` → 读样本（`PermissionError` → 403）→ `detect_encoding` 为 `None` → `binary` → `read_lines`。
  - 模块 docstring 的错误码清单同步。
- `backend/tests/test_project_text.py`（新）：逐条覆盖 SDD 14 §15.1，其中：
  - 编码用例现场生成 UTF-8、UTF-8 BOM、UTF-16 LE BOM、GB18030 文件。
  - 样本边界用例构造第 65536 字节落在三字节汉字中间的文件。
  - 越界用例含指向项目外的符号链接。
  - 行区间用例用 1000 行文件。
  - 字节上限用例用 5 MiB 文件与单行 3 MiB 文件。
  - 另覆盖空文件、`\r\n` 换行、非回环来源 403，以及读取后 `sources.json` 与项目目录不变。
- 门禁：`uv run pytest -q`、`uv run ruff check app tests`、`scripts/ci/check-modality-literals.sh --strict`。

## W2 · agent-runtime

- `agent-runtime/src/pi/tools/read-file.ts`（新），结构对齐 `list-files.ts`：
  - 参数 `{path, start_line?, max_lines?}`，`max_lines` 由 TypeBox 限 1～400，缺省 400。
  - 请求 `/projects/{id}/text`，固定 `max_bytes=65536`。
  - 错误经 `backendFailure` / `unreachable` 转工具错误。
  - 输出：首行写区间说明；正文每行 `<行号>\t<内容>`，单行超 2000 字符截断并追加「[line truncated]」；`eof` 为假时末行写 `Continue with start_line=<end_line+1>.`，为真时写总行数。
  - `details` 为 `glaux.file_read`（SDD 14 §9.2）。
- `agent-runtime/src/pi/harness-registry.ts`：注册 `read_file`，`requires: { project: true }`、`supports: () => true`；提示片段说明只读、行号、续读方式，以及候选模态为 `-` 的文件可能是文本。
- `agent-runtime/src/pi/tools/list-files.ts`：工具说明补一句 `read_file`（SDD 14 §7.4 规则 6）。
- `read_file` 不经 `withProjectGuard`：它不接受对象 id，项目 id 来自会话绑定。
- 测试：在 `tests/integration/project-tools.test.ts` 补充，用注入 `fetch` 模拟后端，覆盖：
  - 挂载条件：项目会话挂载；未归属会话与 `observe` 模式不挂载；无视觉能力仍挂载。
  - 输出格式：行号、续读提示、长行截断、`details`。
  - 错误：`hidden_path`、`binary`、`outside_project` 以 `isError` 返回且回合继续。
- 门禁：`npm run typecheck`、`npm test`。

## W3 · frontend

- 依赖：`@codemirror/state`、`@codemirror/view`、`@codemirror/language`、`@codemirror/search`、`@codemirror/lang-json`、`@codemirror/lang-python`、`@codemirror/lang-markdown`、`@codemirror/lang-yaml`、`@codemirror/lang-javascript`、`@lezer/highlight`，均为当前 6.x / 1.x 稳定版，写入 `package.json` 与 lockfile。
- API：`api/types.ts` 增 `ProjectText`；`api/client.ts` 增 `projectText(projectId, path, opts?)`，错误沿用 `ApiError.code`。
- store：
  - `session.ts` 增 `document: DocumentRef | null` 与 `setDocument`。
  - `setFocus` 收到非空焦点且 `object_id` 与当前不同时，同时把 `document` 置空，一处覆盖 SDD 14 §7.3 规则 8 的全部入口；置为 `null` 不清空，避免 `restoreWorkspace` 后因焦点对象失效调用 `setFocus(null)` 时误清刚恢复的文档。
- 会话工作区：`sessionWorkspaces.ts` 的 `SessionWorkspace`、`Persisted`、`saveWorkspace`、`restoreWorkspace`、持久化写入都加 `document`；读取时校验 `{path: string}`，非法或缺失按 `null`。
- actions：`data/actions.ts` 增 `openProjectDocument(path)`（设置 `document`）与 `closeDocument()`。
- `components/CodeView.tsx`（新）：
  - 在 `useEffect` 中动态 `import()` CodeMirror 与按扩展名选定的语言包。
  - 扩展组合：`EditorState.readOnly.of(true)`、`EditorView.editable.of(false)`、`lineNumbers()`、`highlightSpecialChars()`、`search` 与 `searchKeymap`、`syntaxHighlighting(<HighlightStyle>)`。
  - `EditorView.theme` 与 `HighlightStyle` 的颜色全部写 `var(--…)`，取 `global.css` 现有主题变量。
  - 语言包加载失败时不带语言扩展重建（SDD 14 §13）。
  - `doc` 变化时 `dispatch` 整体替换，卸载时 `destroy`。
- `components/DocumentView.tsx`（新）：
  - 按 `document.path` 请求 `projectText`（`max_bytes=1048576`）；用递增序号丢弃过期响应。
  - 顶栏：文件名、路径、大小、编码、「渲染 / 源码」（仅 Markdown）、「关闭」。
  - `eof` 为假时显示截断提示。
  - 分派规则（SDD 14 §7.3 规则 3）抽成纯函数 `renderKindOf(name)`，便于单测。
  - JSON 格式化在未截断时 `try JSON.parse`；Markdown 复用 `Markdown`，经新增的可选 `components` 参数覆盖 `a`（仅 `http(s)` 渲染为新标签页链接，其余渲染为文字）与 `img`（渲染 alt 文本）。
  - 读取失败时 `setDocument(null)`，并经 notice 或目录树行内错误提示（见下一条）。
- `ProjectTree.tsx`：
  - `modality` 为空的条目改为按钮，点击调用 `openProjectDocument`。
  - 选中态以 `document.path === entry.path` 判定；请求期间 `aria-busy` 防重复点击。
  - `binary` 等错误显示在行内。为让行内错误可见，由 `DocumentView` 把错误写入 store 的一次性字段 `documentError: {path, code}`，`FileLeaf` 读取匹配自身路径的错误；该字段不入会话工作区。
- `StagePanel.tsx`、`Editor.tsx`：
  - 在画布容器内追加 `document && <DocumentView/>`，以绝对定位覆盖；查看器不卸载。
  - 无焦点对象时 `StagePanel` 的占位分支同样渲染覆盖层。
  - 文档打开时隐藏舞台工具条与度量摘要（`StagePanel`）、`ViewerChrome`（`Editor`）。
- `components/agent/FileCard.tsx`（新）：`parseFileRead(details)` 与卡片（文件名、行区间、「在舞台打开」→ `openProjectDocument` 并确保舞台可见，打开方式与 `ObjectCard` 相同）。`AgentConversation.tsx` 在 `ObjectCard` 旁接入。
- i18n：`zh.ts`、`en.ts` 增文案（关闭、渲染、源码、截断提示、不是文本文件、文件卡片按钮、加载中）。
- 样式：`global.css` 增 `.docview` 段，含覆盖层、顶栏、正文滚动与 `.md` 在文档视图中的宽度。
- 测试（jsdom 下 CodeMirror 的测量 API 不完整，`DocumentView` 相关测试 mock `CodeView`）：
  - `renderKindOf` 分派。
  - `DocumentView`：Markdown 不渲染 `<script>`、`<img onerror>`；相对图片无请求；JSON 格式化与非法 JSON 回退；截断提示；失败清空 `document`。
  - `ProjectTree`：非模态文件可点击、行内错误、选中态。
  - `sessionWorkspaces`：`document` 换入换出、持久化、旧条目兼容。
  - `session.setFocus`：设置新的非空焦点时清空 `document`，`setFocus(null)` 不清空。
  - `FileCard` 解析与按钮。
  - `CodeView` 只做挂载冒烟（语言包加载失败时回退）。
- 门禁：`npm run lint`、`npm test`、`npm run build`；在构建产物中确认 CodeMirror 不在入口分块。

## W4 · 收尾

- 活文档：
  - `docs/architecture.zh-CN.md`：端点、`read_file`、文档视图。
  - `docs/runbooks/reference-agent-conversations.md`：智能体工具清单增 `read_file`。
  - `frontend/README.md`：如列依赖则补 CodeMirror。
- SDD 14 §15 逐项自查，标注单测 / 走查依据；状态转 `implemented`，索引同步。
- 浏览器走查：用 `.claude/launch.json` 的 `backend-sdd13` / `frontend-sdd13` 隔离环境。测试项目目录放入以下文件，逐条走 §15.2、§15.4：
  - 带表格与 `<script>` 的 `README.md`；
  - `.py`、`.json`、非法 JSON、GB18030 的 `.txt`；
  - 2 MiB 日志、`.env`、`.zip`、一张 JPEG。
- 真实模型走查（§15.3 末项）：项目内放含测量要求的 `README.md`，以「按项目说明做」发起对话。同时补做 SDD 13 §15.2 未勾的 `open_file` 走查。

## 风险

| 风险 | 处理 |
| --- | --- |
| jsdom 不支持 CodeMirror 的布局测量 | 视图逻辑与 CodeMirror 解耦，单测 mock `CodeView`；真实渲染靠浏览器走查 |
| GB18030 对部分非文本字节序列也能解码 | NUL 检测先行，覆盖绝大多数二进制；SDD 14 §13 已记为已知限制 |
| 超大文件深处续读需从头扫描 | 行读取为流式、内存有界；耗时随偏移线性增长，智能体场景可接受 |
| `setFocus` 清空 `document` 可能被非用户动作触发 | 只在设置非空的新焦点时清空；现有设置非空焦点的唯一路径是 `openObject`（用户或卡片打开对象）；会话切换经 `restoreWorkspace` 直接写字段，不经 `setFocus` |
