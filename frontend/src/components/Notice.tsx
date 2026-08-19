import { useEffect } from "react";

import { useSession } from "../store/session";

// 查看器侧即时提示（队列）：底部居中胶囊，逐条呈现——info 5s / crit 9s 自动消失，点击立即关闭。
// 队列化取代旧单槽覆盖：并发提示不再互相顶掉（医学核检测/画笔/测量失败提示不静默丢失，信任可见 G5）。
const AUTO_HIDE_MS = { info: 5000, crit: 9000 } as const;

export function Notice() {
  const notice = useSession((s) => s.notices[0] ?? null);
  const remaining = useSession((s) => Math.max(0, s.notices.length - 1));
  const dismiss = useSession((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const id = notice.id;
    const timer = window.setTimeout(() => dismiss(id), AUTO_HIDE_MS[notice.tone]);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div className="notice-host" aria-live="polite" role="status">
      <button
        key={notice.id}
        type="button"
        className={`notice notice-enter ${notice.tone}`}
        onClick={() => dismiss(notice.id)}
        title="Dismiss"
      >
        <span className="notice-dot" aria-hidden="true" />
        <span>{notice.text}</span>
        {remaining > 0 && <span className="notice-more" aria-hidden="true">+{remaining}</span>}
      </button>
    </div>
  );
}
