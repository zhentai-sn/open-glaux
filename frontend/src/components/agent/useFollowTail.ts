import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// 跟随滚动（2026-10-24 阅读体验）：只在贴近底部时跟随新输出，用户向上回读就暂停。
// 阈值与 dsh-claude-style 一致（25px）；判定放在这里，组件只管渲染。
const FOLLOW_THRESHOLD_PX = 25;

function atBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX;
}

// jsdom 不保证有 rAF；没有时退回 setTimeout，语义只差一帧。
function requestFrame(callback: () => void): number {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(callback, 0);
}

function cancelFrame(id: number): void {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(id);
  } else {
    window.clearTimeout(id);
  }
}

export interface FollowTail {
  following: boolean;
  /** 回到底部并恢复跟随；用于“回到最新”胶囊与发送后。 */
  jumpToLatest: () => void;
}

/**
 * @param revision 每次内容变化换一个新值（直接传消息数组）——变化时按当前跟随状态滚动。
 * @param resetKey 切换会话等“必须回到最新”的场景，变化时立即贴底并恢复跟随。
 * @param enabled 用户在设置里的跟随开关；关闭后只在发送/切会话时到底。
 */
export function useFollowTail(
  ref: RefObject<HTMLElement>,
  { revision, resetKey, enabled = true }: { revision: unknown; resetKey?: string | null; enabled?: boolean },
): FollowTail {
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const frameRef = useRef<number | null>(null);

  const setFollow = useCallback((next: boolean) => {
    if (followingRef.current === next) return;
    followingRef.current = next;
    setFollowing(next);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ref]);

  const scheduleScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestFrame(() => {
      frameRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  const jumpToLatest = useCallback(() => {
    setFollow(true);
    scrollToBottom();
  }, [setFollow, scrollToBottom]);

  // 新内容到达：跟随且开关打开时贴底；否则一旦离开底部就退出跟随（开关关闭时也提示“回到最新”）。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (enabled && followingRef.current) {
      scheduleScroll();
      return;
    }
    if (!atBottom(el)) setFollow(false);
  }, [revision, enabled, ref, scheduleScroll, setFollow]);

  // 切会话：立即到底并恢复跟随，不等下一帧。
  useLayoutEffect(() => {
    setFollow(true);
    scrollToBottom();
  }, [resetKey, scrollToBottom, setFollow]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setFollow(atBottom(el));
    // 指针/滚轮只用于尽快暂停：真正的状态仍以滚动位置为准。
    const hold = () => {
      if (!atBottom(el)) setFollow(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", hold, { passive: true });
    el.addEventListener("touchstart", hold, { passive: true });
    el.addEventListener("pointerdown", hold);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", hold);
      el.removeEventListener("touchstart", hold);
      el.removeEventListener("pointerdown", hold);
      if (frameRef.current !== null) {
        cancelFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [ref, setFollow]);

  return { following, jumpToLatest };
}
