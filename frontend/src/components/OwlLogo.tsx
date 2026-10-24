// Glaux 小鸮标识（γλαύξ）——心形面盘 + 两只负形眼，单一来源：TitleBar / Focus 顶栏 / 空状态 hero / 智能体消息徽标共用。
// 16 网格主稿（不是 32 网格缩图）：剪影是椭圆面盘，头顶中央切一个 V 形缺口作为耳羽，两只眼是负形。
// 全部形状由负形构成，没有外凸尖角；2 色，无描边、无肚皮、无脚、无高光（详见
// docs/designs/2026-10-24-001-owl-mark-rework.zh-CN.md §5）。
// 尺寸取 16 的整数倍（16 / 32 / 48）时一个网格单元正好落在整像素上，硬边不歪斜。
// 颜色为品牌固定值（面盘 #7c4dd6 / 眼 #f0eafc），不随用户强调色变化：
// 品牌标识与界面强调色分离（SDD 12 §7.2）。
export function OwlLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {/* 耳丘与面盘上缘（V 缺口在 x=7..9） */}
      <rect x={5} y={4} width={2} height={1} fill="#7c4dd6" />
      <rect x={9} y={4} width={2} height={1} fill="#7c4dd6" />
      <rect x={4} y={5} width={3} height={1} fill="#7c4dd6" />
      <rect x={9} y={5} width={3} height={1} fill="#7c4dd6" />
      <rect x={3} y={6} width={10} height={1} fill="#7c4dd6" />
      {/* 第一行眼：面盘 + 眼 + 隔断 + 眼 + 面盘 */}
      <rect x={2} y={7} width={2} height={1} fill="#7c4dd6" />
      <rect x={4} y={7} width={2} height={1} fill="#f0eafc" />
      <rect x={6} y={7} width={4} height={1} fill="#7c4dd6" />
      <rect x={10} y={7} width={2} height={1} fill="#f0eafc" />
      <rect x={12} y={7} width={2} height={1} fill="#7c4dd6" />
      <rect x={2} y={8} width={2} height={1} fill="#7c4dd6" />
      <rect x={4} y={8} width={3} height={1} fill="#f0eafc" />
      <rect x={7} y={8} width={2} height={1} fill="#7c4dd6" />
      <rect x={9} y={8} width={3} height={1} fill="#f0eafc" />
      <rect x={12} y={8} width={2} height={1} fill="#7c4dd6" />
      <rect x={2} y={9} width={1} height={1} fill="#7c4dd6" />
      <rect x={3} y={9} width={4} height={1} fill="#f0eafc" />
      <rect x={7} y={9} width={2} height={1} fill="#7c4dd6" />
      <rect x={9} y={9} width={4} height={1} fill="#f0eafc" />
      <rect x={13} y={9} width={1} height={1} fill="#7c4dd6" />
      <rect x={2} y={10} width={2} height={1} fill="#7c4dd6" />
      <rect x={4} y={10} width={3} height={1} fill="#f0eafc" />
      <rect x={7} y={10} width={2} height={1} fill="#7c4dd6" />
      <rect x={9} y={10} width={3} height={1} fill="#f0eafc" />
      <rect x={12} y={10} width={2} height={1} fill="#7c4dd6" />
      {/* 面盘下缘收口 */}
      <rect x={2} y={11} width={12} height={1} fill="#7c4dd6" />
      <rect x={3} y={12} width={10} height={1} fill="#7c4dd6" />
      <rect x={4} y={13} width={8} height={1} fill="#7c4dd6" />
      <rect x={6} y={14} width={4} height={1} fill="#7c4dd6" />
    </svg>
  );
}
