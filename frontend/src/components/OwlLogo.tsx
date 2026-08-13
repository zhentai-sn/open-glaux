// Glaux 小鸮标识（γλαύξ）——单一来源，TitleBar / Focus 顶栏 / 空状态 hero / 智能体消息徽标共用。
export function OwlLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="10" r="3.2" stroke="#B58BF2" strokeWidth="1.7" />
      <circle cx="16" cy="10" r="3.2" stroke="#B58BF2" strokeWidth="1.7" />
      <circle cx="8" cy="10" r="1" fill="#4FB0FF" />
      <circle cx="16" cy="10" r="1" fill="#4FB0FF" />
      <path d="M6 16.4c1.6 1.4 4 1.4 6 1.4s4.4 0 6-1.4" stroke="#B58BF2" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
