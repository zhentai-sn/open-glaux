// SDD 25：可选模型组件的状态与安装动作。安装中按 500ms 轮询单个 pack 的进度。
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { PackProgress, PackRow } from "../api/types";

const POLL_MS = 500;

export interface PacksState {
  packs: PackRow[];
  progress: Record<string, PackProgress>;
  error: string | null;
  install: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

export function usePacks(enabled = true): PacksState {
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [progress, setProgress] = useState<Record<string, PackProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await api.packs();
      setPacks(data.packs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 轮询：只看状态为 installing 的 pack；到终态立即重载列表并停止。
  const installingKey = packs
    .filter((p) => p.status === "installing")
    .map((p) => p.id)
    .join("|");

  useEffect(() => {
    const ids = installingKey ? installingKey.split("|") : [];
    if (!ids.length) return;
    let alive = true;

    const tick = async () => {
      for (const id of ids) {
        try {
          const next = await api.packProgress(id);
          if (!alive) return;
          setProgress((prev) => ({ ...prev, [id]: next }));
          if (next.status !== "installing") {
            await reload();
            return;
          }
        } catch {
          // 单次失败不终止轮询；下一次继续
        }
      }
      if (alive) timer.current = window.setTimeout(() => void tick(), POLL_MS);
    };

    timer.current = window.setTimeout(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [installingKey, reload]);

  const install = useCallback(
    async (id: string) => {
      await api.installPack(id);
      await reload();
    },
    [reload],
  );

  const cancel = useCallback(
    async (id: string) => {
      await api.cancelPack(id);
      await reload();
    },
    [reload],
  );

  const uninstall = useCallback(
    async (id: string) => {
      await api.uninstallPack(id);
      await reload();
    },
    [reload],
  );

  return { packs, progress, error, install, cancel, uninstall };
}
