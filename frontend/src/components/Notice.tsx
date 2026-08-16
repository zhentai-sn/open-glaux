import { useEffect } from "react";

import { useSession } from "../store/session";

// 查看器侧即时提示（单槽）：底部居中胶囊，info 5s / crit 9s 自动消失，点击立即关闭。
// 取代旧 `messages/pushAgent` 通道（自 SDD 01 起无渲染，导致核检测/画笔/测量失败静默）。
const AUTO_HIDE_MS = { info: 5000, crit: 9000 } as const;

export function Notice() {
  const notice = useSession((s) => s.notice);
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
        type="button"
        className={`notice ${notice.tone}`}
        onClick={() => dismiss(notice.id)}
        title="Dismiss"
      >
        <span className="notice-dot" aria-hidden="true" />
        <span>{notice.text}</span>
      </button>
    </div>
  );
}
