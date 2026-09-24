#!/usr/bin/env bash
# 模态字面量比较计数（SDD 10 §7 规则 9–10、D-14）。
#
# 用途：统计核心目录里「拿模态字面量做分支判断」的命中数，使「先清零字面量、再把
# Modality / TaskType 放宽为 str」这条顺序约束可检查。make test 使用 --strict
# 阻断式门禁。
#
# 用法：scripts/ci/check-modality-literals.sh [--list] [--strict]
#   --list    逐条打印命中（path:line: 源码行）
#   --strict  总命中数 > 0 时退出码 1（缺省恒为 0）
#
# 模态字面量：backend/app/datasource_registry.py 的 MODALITIES 五项
#   carotid_imt fetal_hc ct_abdomen pathology natural_image，外加 video。
#   注：fetal_hc 同时是 TaskType 取值，对它的比较不区分模态轴与任务轴，一并计入。
#
# 受管范围（规则 9）：
#   frontend       frontend/src，排除 frontend/src/plugins/
#   backend        backend/app，排除 backend/app/sources/、backend/app/detectors/
#   agent-runtime  agent-runtime/src（规则 9 未覆盖，仅报告，不计入门禁总数）
#   只扫 *.ts / *.tsx / *.py。
#
# 排除的文件及理由：
#   - 测试文件 *.test.ts(x)、test_*.py、*_test.py、frontend/src/test/：测试断言以字面量
#     构造夹具是正当用法，不是产品分支。
#   - frontend/src/i18n/：词典按键登记文案，是注册表，不是分支。
#
# 计入的「比较」（逐行匹配；L 表示用单/双引号包裹的模态字面量）：
#   1. 相等比较：L 左右任一侧紧邻 === / !== / == / !=
#        modality === "natural_image"、"pathology" != m
#   2. case 分支：case L（TS switch 与 Python match，含 case "a" | "b"）
#   3. Python 成员判断：in / not in 后跟 ( [ { 字面量列表且列表中含 L
#        if modality in ("pathology", "ct_abdomen")
#   4. JS 成员判断：.includes(L)，或含 L 的数组字面量直接调 .includes(
#        ["ct_abdomen", "pathology"].includes(modality)
#   同一行对同一字面量只计 1 次；一行比较多个字面量时每个字面量各计 1 次。
#
# 不计入（登记与赋值，不是分支）：
#   - 注释行（行首为 // # * /*）
#   - 类型声明与枚举：Modality = Literal[...]、type Modality = "a" | "b"
#   - 默认值与赋值：modality: Modality = "carotid_imt"、MODALITY = "fetal_hc"
#   - 注册表键与字段值：{"modality": "pathology"}、{ modality: "ct_abdomen", ... }
#   - 函数实参：setModality("natural_image")、resolve_root("pathology")
#   - Python for 迭代：for m in ("a", "b")
#   以上以「其他提及」给出行数，仅供参考，不计入总数。
#
# 已知局限：逐行匹配，跨行书写的比较（运算符与字面量不在同一行）不会被计入；
#   与变量或常量比较（modality == MODALITY）不计入。
#
# 搜索工具：有 rg 用 rg，否则用 grep -E；两者使用同一组 ERE 兼容正则。

set -euo pipefail

LIST=0
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --list) LIST=1 ;;
    --strict) STRICT=1 ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LITERALS=(carotid_imt fetal_hc ct_abdomen pathology natural_image video)
SECTIONS=(frontend backend agent-runtime)

Q="[\"']"
ID="${Q}[A-Za-z0-9_]+${Q}"
OP="(===|!==|==|!=)"

if command -v rg >/dev/null 2>&1; then
  SEARCH=(rg -n -H --no-heading --color never)
  TOOL=rg
else
  SEARCH=(grep -n -H -E)
  TOOL="grep -E"
fi

# 列出某一节的受管文件（NUL 分隔）。
list_files() {
  case "$1" in
    frontend)
      find frontend/src -path frontend/src/plugins -prune -o \
        -path frontend/src/i18n -prune -o -path frontend/src/test -prune -o \
        -type f \( -name '*.ts' -o -name '*.tsx' \) \
        ! -name '*.test.ts' ! -name '*.test.tsx' -print0 ;;
    backend)
      find backend/app -path backend/app/sources -prune -o \
        -path backend/app/detectors -prune -o \
        -type f -name '*.py' ! -name 'test_*.py' ! -name '*_test.py' -print0 ;;
    agent-runtime)
      find agent-runtime/src -type f \( -name '*.ts' -o -name '*.tsx' \) \
        ! -name '*.test.ts' ! -name '*.test.tsx' -print0 ;;
  esac
}

# 对一个字面量生成计入规则的正则。
patterns_for() {
  local L="${Q}$1${Q}"
  printf '%s\n' \
    "${OP}[[:space:]]*${L}" \
    "${L}[[:space:]]*${OP}" \
    "\\bcase[[:space:]][^:]*${L}" \
    "\\bin[[:space:]]*(\\(|\\[|\\{)([[:space:]]*${ID}[[:space:]]*,)*[[:space:]]*${L}" \
    "\\.includes\\([[:space:]]*${L}" \
    "\\[([[:space:]]*${ID}[[:space:]]*,)*[[:space:]]*${L}([[:space:]]*,[[:space:]]*${ID})*[[:space:]]*,?[[:space:]]*\\][[:space:]]*(as const[[:space:]]*\\)?[[:space:]]*)?\\.includes\\("
}

COMMENT_RE='^[^:]+:[0-9]+:[[:space:]]*(//|#|/?\*)'
FOR_IN_RE="\\bfor[[:space:]]+[A-Za-z_][A-Za-z0-9_, ]*[[:space:]]in[[:space:]]*(\\(|\\[|\\{)"

# search <files-nul-file> <pattern>...：输出 path:line:text，已去掉注释行与 for 迭代行。
search() {
  local files="$1"; shift
  local args=()
  local p
  for p in "$@"; do args+=(-e "$p"); done
  [ -s "$files" ] || return 0
  xargs -0 "${SEARCH[@]}" "${args[@]}" < "$files" 2>/dev/null \
    | grep -vE "$COMMENT_RE" | grep -vE "$FOR_IN_RE" || true
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

declare -A COUNT
declare -A MENTION
for sec in "${SECTIONS[@]}"; do
  list_files "$sec" > "$TMP/$sec.files"
  : > "$TMP/$sec.hits"
  for lit in "${LITERALS[@]}"; do
    mapfile -t pats < <(patterns_for "$lit")
    search "$TMP/$sec.files" "${pats[@]}" | sort -u > "$TMP/$sec.$lit.hits"
    COUNT["$sec,$lit"]=$(wc -l < "$TMP/$sec.$lit.hits" | tr -d ' ')
    cat "$TMP/$sec.$lit.hits" >> "$TMP/$sec.hits"
  done
  # 其他提及：含任一带引号字面量、但不在命中行里的非注释行。
  alt="$(IFS='|'; echo "${LITERALS[*]}")"
  search "$TMP/$sec.files" "${Q}(${alt})${Q}" | sort -u > "$TMP/$sec.mentions"
  sort -u "$TMP/$sec.hits" -o "$TMP/$sec.hits"
  MENTION["$sec"]=$(comm -23 "$TMP/$sec.mentions" "$TMP/$sec.hits" | wc -l | tr -d ' ')
done

echo "模态字面量比较计数（SDD 10 规则 9 / D-14；搜索工具：$TOOL）"
echo "范围：frontend=frontend/src 除 plugins/；backend=backend/app 除 sources/、detectors/；"
echo "      agent-runtime=agent-runtime/src（仅报告，不计入门禁总数）"
echo
printf '%-15s %10s %10s %15s %8s\n' literal frontend backend agent-runtime gate
declare -A SECSUM=([frontend]=0 [backend]=0 [agent-runtime]=0)
GATE_TOTAL=0
for lit in "${LITERALS[@]}"; do
  f=${COUNT["frontend,$lit"]}; b=${COUNT["backend,$lit"]}; a=${COUNT["agent-runtime,$lit"]}
  SECSUM[frontend]=$((SECSUM[frontend] + f))
  SECSUM[backend]=$((SECSUM[backend] + b))
  SECSUM[agent-runtime]=$((SECSUM[agent-runtime] + a))
  GATE_TOTAL=$((GATE_TOTAL + f + b))
  printf '%-15s %10s %10s %15s %8s\n' "$lit" "$f" "$b" "$a" "$((f + b))"
done
printf '%-15s %10s %10s %15s %8s\n' total "${SECSUM[frontend]}" "${SECSUM[backend]}" "${SECSUM[agent-runtime]}" "$GATE_TOTAL"
printf '%-15s %10s %10s %15s\n' "其他提及" "${MENTION[frontend]}" "${MENTION[backend]}" "${MENTION[agent-runtime]}"
echo
echo "门禁总数（frontend + backend）：$GATE_TOTAL"

if [ "$LIST" -eq 1 ]; then
  for sec in "${SECTIONS[@]}"; do
    echo
    echo "== $sec 命中 =="
    if [ -s "$TMP/$sec.hits" ]; then
      sort -t: -k1,1 -k2,2n "$TMP/$sec.hits" | sed -E 's/^([^:]+:[0-9]+):[[:space:]]*/\1: /'
    else
      echo "(无)"
    fi
  done
fi

if [ "$STRICT" -eq 1 ] && [ "$GATE_TOTAL" -gt 0 ]; then
  exit 1
fi
exit 0
