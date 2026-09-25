// Glaux 小鸮标识（γλαύξ）——单一来源，TitleBar / Focus 顶栏 / 空状态 hero / 智能体消息徽标共用。
// 轮廓走 --agent（跟随主题与用户强调色，SDD feats/12 §7.2），瞳孔走 --li（浅色主题取深一档保证对比度）。
export function OwlLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      style={{ color: "var(--agent)" }}
      aria-hidden="true"
    >
      <circle cx="8" cy="10" r="3.2" strokeWidth="2.1" />
      <circle cx="16" cy="10" r="3.2" strokeWidth="2.1" />
      <circle cx="8" cy="10" r="1" stroke="none" style={{ fill: "var(--li)" }} />
      <circle cx="16" cy="10" r="1" stroke="none" style={{ fill: "var(--li)" }} />
      <path d="M6 16.4c1.6 1.4 4 1.4 6 1.4s4.4 0 6-1.4" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
