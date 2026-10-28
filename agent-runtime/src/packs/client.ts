/**
 * SDD 25 §7.8：可选组件（Model Packs）就绪状态查询。
 *
 * 只有声明了 `requires.pack` 的工具受影响；查询失败时降级为空集，**不阻塞其余工具的挂载**。
 * 结果带短 TTL 缓存，避免每次命令组装都打一次 backend。
 */
import { backendBaseUrl } from "../atlas/client.js";

const TTL_MS = 5_000;
const TIMEOUT_MS = 800;

let cached: { at: number; ids: ReadonlySet<string> } | undefined;
let inflight: Promise<ReadonlySet<string>> | undefined;

/** 已就绪的 pack id 集合。永不抛错。 */
export async function readyPacks(now = Date.now()): Promise<ReadonlySet<string>> {
  if (cached && now - cached.at < TTL_MS) return cached.ids;
  if (inflight) return inflight;
  inflight = fetchReady(now).finally(() => { inflight = undefined; });
  return inflight;
}

async function fetchReady(now: number): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  try {
    const base = backendBaseUrl().replace(/\/+$/u, "");
    const res = await fetch(`${base}/packs`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { packs?: { id?: unknown; status?: unknown }[] };
    for (const item of body.packs ?? []) {
      if (item.status === "ready" && typeof item.id === "string") ids.add(item.id);
    }
  } catch {
    // 降级为空集：needs_pack 的工具不挂载，其余工具照常
  }
  cached = { at: now, ids };
  return ids;
}

/** 测试用：清空缓存。 */
export function resetPackCache(): void {
  cached = undefined;
  inflight = undefined;
}
