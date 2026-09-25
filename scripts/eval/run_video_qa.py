"""视频问答评测驱动：逐题上传片段、经 agent-runtime 提问、收集结构化回答、评分并估算成本。

前置：backend 与 agent-runtime（:8010）已启动；变量写在仓库根 .env（模板见 .env.example）
    GLAUX_EVAL_QWEN_KEY       Qwen API Key（只随请求发给 runtime，不落盘、不打印）
    GLAUX_EVAL_QWEN_BASE_URL  以 /compatible-mode/v1 结尾的 DashScope 地址
    GLAUX_BACKEND_URL         可选，须与 agent-runtime 进程指向同一个 backend，缺省 :8000
用法：
    backend/.venv/bin/python scripts/eval/run_video_qa.py --n 10
计划见 docs/plans/2026-09-25-video-eval-tennistv-bard-plan.md（E2）。
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import random
import re
import sys
import threading
import time
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path) -> None:
    """读仓库根 .env（`[export ]KEY=VALUE`），不覆盖已有环境变量。"""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_dotenv(REPO / ".env")
MANIFEST = REPO / "data" / "eval" / "tennistv" / "manifest.jsonl"
RUNS = REPO / "data" / "eval" / "tennistv" / "runs"
# 必须与 agent-runtime 进程的 GLAUX_BACKEND_URL 指向同一个 backend
BACKEND = os.environ.get("GLAUX_BACKEND_URL", "http://127.0.0.1:8000")
RUNTIME = os.environ.get("GLAUX_AGENT_URL", "http://127.0.0.1:8010") + "/agent-api/v1"
MODEL = "qwen3.8-omni-flash"
UPLOAD_NAME = "eval-tennistv"
ANSWER_RE = re.compile(r"答案\s*[:：]\s*([A-F1-9TF])\b")

PROMPT = """请根据视频回答下面的选择题。先观察视频再作答，回答要引用你实际观察过的区间作为证据。
提交回答时，第一条 claim 的文字必须以「答案：X」开头，X 是所选选项的编号，只写一个；随后简述依据。
{time_hint}
题目：{question}
选项：
{options}"""
TIME_HINT = "本题问的是时间段：第一条 claim 的证据区间应尽量精确地覆盖该动作发生的时间段。"


# ---------- 选题 ----------

def pick_cases(rows: list[dict], n: int, seed: int, tasks: list[str] | None) -> list[dict]:
    """按任务分层抽样：先每类各取一题，再补 MGG（可评时间证据），不够再随机补。"""
    rng = random.Random(seed)
    by: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if not tasks or r["task"] in tasks:
            by[r["task"]].append(r)
    for v in by.values():
        rng.shuffle(v)
    order = sorted(by)
    picked = [by[t].pop() for t in order if by[t]][:n]
    while len(picked) < n and by.get("MGG"):
        picked.append(by["MGG"].pop())
    rest = [r for t in order for r in by[t]]
    rng.shuffle(rest)
    picked += rest[: n - len(picked)]
    return picked


# ---------- 调用 ----------

def connection() -> dict:
    key, base = os.environ.get("GLAUX_EVAL_QWEN_KEY"), os.environ.get("GLAUX_EVAL_QWEN_BASE_URL")
    if not key or not base:
        sys.exit("需要环境变量 GLAUX_EVAL_QWEN_KEY 与 GLAUX_EVAL_QWEN_BASE_URL")
    return {"provider": "openai-compatible", "model": MODEL, "base_url": base, "credential": key,
            "context_window": 128000, "max_tokens": 8192, "vision": True, "media_adapter": "qwen-omni"}


def upload(client: httpx.Client, path: Path) -> dict:
    with path.open("rb") as f:
        r = client.post(f"{BACKEND}/uploads/images", data={"name": UPLOAD_NAME},
                        files={"files": (path.name, f, "video/mp4")}, timeout=120)
    r.raise_for_status()
    body = r.json()
    if not body["accepted"]:
        raise RuntimeError(f"上传被拒：{body['rejected']}")
    oid = body["accepted"][0]["id"]
    obj = client.get(f"{BACKEND}/objects/{oid}", timeout=30).raise_for_status().json()
    return obj


def new_session(client: httpx.Client, title: str) -> str:
    r = client.post(f"{RUNTIME}/sessions", json={"session_id": str(uuid.uuid4()), "title": title,
                                                  "permission_mode": "observe"}, timeout=30)
    r.raise_for_status()
    view = r.json()
    sid = view["session_id"]
    if view.get("permission_mode") != "observe":
        client.patch(f"{RUNTIME}/sessions/{sid}", json={"permission_mode": "observe"}, timeout=30).raise_for_status()
    return sid


def listen(sid: str, out: queue.Queue, stop: threading.Event) -> None:
    """SSE 读取线程：把 (event, data) 放进队列。"""
    try:
        with httpx.stream("GET", f"{RUNTIME}/sessions/{sid}/events", timeout=httpx.Timeout(10, read=None)) as r:
            name = None
            for line in r.iter_lines():
                if stop.is_set():
                    return
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:") and name:
                    out.put((name, json.loads(line[5:].strip())))
                    name = None
    except Exception as e:  # noqa: BLE001 — 线程内异常转交主线程
        out.put(("listener.error", {"message": str(e)}))


def ask(client: httpx.Client, case: dict, conn: dict, timeout_s: float) -> dict:
    obj = upload(client, REPO / case["clip_path"])
    sid = new_session(client, f"eval {case['id']}")
    events: queue.Queue = queue.Queue()
    stop = threading.Event()
    threading.Thread(target=listen, args=(sid, events, stop), daemon=True).start()
    first = events.get(timeout=15)  # snapshot，确认 SSE 已连上再发命令
    if first[0] != "snapshot":
        raise RuntimeError(f"SSE 未就绪：{first}")

    options = "\n".join(f"{k}. {v}" for k, v in case["options"].items())
    content = PROMPT.format(question=case["question"], options=options,
                            time_hint=TIME_HINT if case["task"] == "MGG" else "").replace("\n\n", "\n")
    cid = str(uuid.uuid4())
    body = {"command_id": cid, "type": "prompt", "content": content, "connection": conn,
            "viewer": {"collection": "video",
                       "object": {"id": obj["id"], "kind": "video", "axes": obj["axes"],
                                  "calibration": obj.get("calibration")},
                       "focus": {"object_id": obj["id"], "kind": "video", "index": {"t": 0}, "region": None}}}
    t0 = time.monotonic()
    r = client.post(f"{RUNTIME}/sessions/{sid}/commands", json=body, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"命令被拒 {r.status_code}：{r.text[:300]}")

    usage = defaultdict(int)
    observe_calls, errors, answer, ended = 0, [], None, False
    while time.monotonic() - t0 < timeout_s:
        try:
            name, data = events.get(timeout=5)
        except queue.Empty:
            if ended:
                break
            continue
        if name == "pi.event":
            ev = data["event"]
            if ev["type"] == "message_end" and ev["message"].get("role") == "assistant":
                for k, v in (ev["message"].get("usage") or {}).items():
                    if isinstance(v, int):
                        usage[k] += v
            elif ev["type"] == "tool_execution_start" and ev.get("toolName") == "observe_video_interval":
                observe_calls += 1
            elif ev["type"] == "agent_end":
                ended = True
        elif name == "video.answer" and data.get("command_id") == cid:
            answer = data["answer"]
        elif name in ("adapter.error", "listener.error"):
            errors.append(data.get("code") or data.get("message"))
            ended = True
    elapsed = time.monotonic() - t0
    stop.set()

    view = wait_idle(client, sid)
    if answer is None:
        answer = next((a["answer"] for a in view.get("video_answers", []) if a["command_id"] == cid), None)
    observations = view.get("video_observations", [])  # 每题一个新会话，全部属于本题
    final_text = last_assistant_text(view)
    return {"session_id": sid, "object_id": obj["id"], "elapsed_s": round(elapsed, 1),
            "timed_out": not ended, "errors": errors, "observe_calls": observe_calls,
            "observations": [{**o["actual_interval"], "fps": o["fps"]} for o in observations],
            "usage": dict(usage), "answer": answer, "final_text": final_text}


def wait_idle(client: httpx.Client, sid: str, limit_s: float = 30) -> dict:
    t0 = time.monotonic()
    while True:
        view = client.get(f"{RUNTIME}/sessions/{sid}", timeout=30).raise_for_status().json()
        if view.get("phase") in (None, "idle") or time.monotonic() - t0 > limit_s:
            return view
        time.sleep(1)


def last_assistant_text(view: dict) -> str:
    for m in reversed(view.get("messages", [])):
        if m.get("role") == "assistant":
            parts = m.get("content")
            if isinstance(parts, str):
                return parts
            return "".join(p.get("text", "") for p in parts or [] if p.get("type") == "text")
    return ""


# ---------- 评分 ----------

def parse_choice(case: dict, res: dict) -> str | None:
    texts = [c["text"] for c in (res["answer"] or {}).get("claims", [])] + [res["final_text"]]
    for t in texts:
        m = ANSWER_RE.search(t or "")
        if m and m[1] in case["options"]:
            return m[1]
    return None


def interval_iou(a: tuple[int, int], b: tuple[int, int]) -> float:
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    return inter / union if union > 0 else 0.0


def score(case: dict, res: dict) -> dict:
    choice = parse_choice(case, res)
    out = {"choice": choice, "correct": choice == case["answer"],
           "answered": bool(res["answer"] and res["answer"].get("claims"))}
    if case["task"] == "MGG":
        claims = (res["answer"] or {}).get("claims", [])
        spans = [(e["source_interval"]["start_ms"], e["source_interval"]["end_ms"])
                 for c in claims[:1] for e in c["evidence"]]
        gold = tuple(case["gold_interval_ms"])
        out["evidence_iou"] = round(max((interval_iou(s, gold) for s in spans), default=0.0), 3)
    return out


def cost_usd(usage: dict, price: dict) -> float:
    return (usage.get("input", 0) * price["input"] + usage.get("output", 0) * price["output"]
            + usage.get("cacheRead", 0) * price["cache"]) / 1e6


# ---------- 主流程 ----------

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--n", type=int, default=10)
    p.add_argument("--seed", type=int, default=20260925)
    p.add_argument("--tasks", nargs="*", help="只评这些任务，如 MGG RC")
    p.add_argument("--timeout", type=float, default=300, help="单题超时秒数")
    p.add_argument("--price-in", type=float, default=0.15, help="输入单价，美元/百万 token")
    p.add_argument("--price-out", type=float, default=0.47, help="输出单价，美元/百万 token")
    p.add_argument("--price-cache", type=float, default=0.016, help="缓存命中单价，美元/百万 token")
    args = p.parse_args()
    price = {"input": args.price_in, "output": args.price_out, "cache": args.price_cache}

    rows = [json.loads(l) for l in MANIFEST.read_text().splitlines() if l.strip()]
    cases = pick_cases(rows, args.n, args.seed, args.tasks)
    conn = connection()
    run_dir = RUNS / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True)
    results = []
    with httpx.Client() as client, (run_dir / "results.jsonl").open("w") as f:
        for i, case in enumerate(cases, 1):
            try:
                res = ask(client, case, conn, args.timeout)
                sc = score(case, res)
            except Exception as e:  # noqa: BLE001 — 单题失败不中断整批
                res, sc = {"errors": [f"{type(e).__name__}: {e}"], "usage": {}, "elapsed_s": None,
                           "observe_calls": 0}, {"choice": None, "correct": False, "answered": False}
            row = {"id": case["id"], "task": case["task"], "clip": case["clip"], "gold": case["answer"],
                   **sc, **res, "cost_usd": round(cost_usd(res["usage"], price), 6)}
            results.append(row)
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()
            iou = f" IoU={row['evidence_iou']}" if "evidence_iou" in row else ""
            print(f"[{i}/{len(cases)}] {case['id']:9} 标准={case['answer']} 选={row['choice']} "
                  f"{'✓' if row['correct'] else '✗'}{iou} 观察={row['observe_calls']} "
                  f"用时={row['elapsed_s']}s tokens={row['usage'].get('totalTokens', 0)} "
                  f"${row['cost_usd']:.4f} {'错误=' + str(row['errors']) if row['errors'] else ''}")
    summarize(results, rows, price, run_dir)


def summarize(results: list[dict], rows: list[dict], price: dict, run_dir: Path) -> None:
    n = len(results)
    ok = sum(r["correct"] for r in results)
    cost = sum(r["cost_usd"] for r in results)
    tokens = defaultdict(int)
    for r in results:
        for k, v in r["usage"].items():
            tokens[k] += v
    per_case = cost / n if n else 0
    summary = {
        "cases": n, "correct": ok, "accuracy": round(ok / n, 3) if n else None,
        "answered": sum(r["answered"] for r in results),
        "unparsed_choice": sum(r["choice"] is None for r in results),
        "errors": sum(bool(r["errors"]) for r in results),
        "mgg_iou": [r["evidence_iou"] for r in results if "evidence_iou" in r],
        "mean_observe_calls": round(sum(r["observe_calls"] for r in results) / n, 2) if n else None,
        "mean_elapsed_s": round(sum(r["elapsed_s"] or 0 for r in results) / n, 1) if n else None,
        "tokens": dict(tokens), "price_usd_per_mtok": price,
        "cost_usd": round(cost, 4), "cost_per_case_usd": round(per_case, 5),
        "projected_usd": {"pilot_431": round(per_case * len(rows), 2), "full_2527": round(per_case * 2527, 2)},
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    print(f"结果 → {run_dir}")


if __name__ == "__main__":
    main()
