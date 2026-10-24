// 小鸮吉祥物（品牌皮肤 2026-10-21）——输入框上沿的状态角色。
// 帧图是 32×32 网格的 8 列 strip（src/assets/mascot/），按状态逐帧播放，切状态回到首帧。
// prefers-reduced-motion 下停在首帧，不做循环（纲领 G10 / 设计 §4.4）。
import { useEffect, useState } from "react";

import blinkUrl from "../assets/mascot/mascot-blink.png";
import errorUrl from "../assets/mascot/mascot-error.png";
import happyUrl from "../assets/mascot/mascot-happy.png";
import idleUrl from "../assets/mascot/mascot-idle.png";
import notificationUrl from "../assets/mascot/mascot-notification.png";
import pokeUrl from "../assets/mascot/mascot-poke.png";
import sleepingUrl from "../assets/mascot/mascot-sleeping.png";
import thinkingUrl from "../assets/mascot/mascot-thinking.png";
import typingUrl from "../assets/mascot/mascot-typing.png";
import wakingUrl from "../assets/mascot/mascot-waking.png";

export type MascotState =
  | "idle"
  | "blink"
  | "thinking"
  | "typing"
  | "happy"
  | "error"
  | "notification"
  | "sleeping"
  | "waking"
  | "poke";

interface Track {
  src: string;
  frames: number;
  ms: number;
}

/** 每状态的帧数与帧时长，见设计 §4.2。 */
export const MASCOT_TRACKS: Record<MascotState, Track> = {
  idle: { src: idleUrl, frames: 4, ms: 520 },
  blink: { src: blinkUrl, frames: 2, ms: 140 },
  thinking: { src: thinkingUrl, frames: 4, ms: 220 },
  typing: { src: typingUrl, frames: 4, ms: 110 },
  happy: { src: happyUrl, frames: 4, ms: 140 },
  error: { src: errorUrl, frames: 3, ms: 180 },
  notification: { src: notificationUrl, frames: 3, ms: 260 },
  sleeping: { src: sleepingUrl, frames: 2, ms: 1400 },
  waking: { src: wakingUrl, frames: 3, ms: 130 },
  poke: { src: pokeUrl, frames: 2, ms: 130 },
};

const COLS = 8;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 待机时多久眨一次眼（ms），随机区间。 */
const BLINK_MIN_MS = 8000;
const BLINK_MAX_MS = 15000;

export function Mascot({ state = "idle", size = 64 }: { state?: MascotState; size?: number }) {
  const [frame, setFrame] = useState(0);
  const [blinking, setBlinking] = useState(false);

  // 待机时随机眨眼：只在 idle 期间排程，进入其它状态立即复位。
  useEffect(() => {
    if (state !== "idle" || prefersReducedMotion()) {
      setBlinking(false);
      return;
    }
    const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    const timer = setTimeout(() => setBlinking(true), delay);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (!blinking) return;
    const timer = setTimeout(() => setBlinking(false), MASCOT_TRACKS.blink.ms * MASCOT_TRACKS.blink.frames);
    return () => clearTimeout(timer);
  }, [blinking]);

  const track = MASCOT_TRACKS[blinking && state === "idle" ? "blink" : state];

  useEffect(() => {
    setFrame(0);
    if (track.frames <= 1 || prefersReducedMotion()) return;
    let next = 0;
    const timer = setInterval(() => {
      next = (next + 1) % track.frames;
      setFrame(next);
    }, track.ms);
    return () => clearInterval(timer);
  }, [state, track.frames, track.ms]);

  const col = frame % COLS;
  const row = Math.floor(frame / COLS);
  const rows = Math.max(1, Math.ceil(track.frames / COLS));

  return (
    <span
      className="mascot"
      aria-hidden="true"
      data-state={state}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${track.src})`,
        backgroundSize: `${size * COLS}px ${size * rows}px`,
        backgroundPosition: `${-col * size}px ${-row * size}px`,
      }}
    />
  );
}
