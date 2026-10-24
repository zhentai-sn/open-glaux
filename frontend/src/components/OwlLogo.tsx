// Glaux 小鸮标识（γλαύξ）——像素形象，单一来源：TitleBar / Focus 顶栏 / 空状态 hero / 智能体消息徽标共用。
// 几何取自品牌图标（docs/designs/assets/2026-10-21-brand-skin/glaux-owl-a），内联为矢量矩形，
// 因此 18px 与 40px 下都保持像素硬边（shapeRendering="crispEdges"）。
// 颜色为品牌固定值（身体 #7c4dd6 / 面盘 #f0eafc / 瞳孔 #2a1b4a），不随用户强调色变化：
// 品牌标识与界面强调色分离（SDD 12 §7.2）。
export function OwlLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <rect x={7} y={4} width={2} height={1} fill="#7c4dd6" />
      <rect x={23} y={4} width={2} height={1} fill="#7c4dd6" />
      <rect x={7} y={5} width={3} height={1} fill="#7c4dd6" />
      <rect x={22} y={5} width={3} height={1} fill="#7c4dd6" />
      <rect x={7} y={6} width={18} height={1} fill="#7c4dd6" />
      <rect x={8} y={7} width={16} height={1} fill="#7c4dd6" />
      <rect x={7} y={8} width={18} height={1} fill="#7c4dd6" />
      <rect x={6} y={9} width={3} height={1} fill="#7c4dd6" />
      <rect x={9} y={9} width={5} height={1} fill="#f0eafc" />
      <rect x={14} y={9} width={4} height={1} fill="#7c4dd6" />
      <rect x={18} y={9} width={5} height={1} fill="#f0eafc" />
      <rect x={23} y={9} width={3} height={1} fill="#7c4dd6" />
      <rect x={6} y={10} width={2} height={1} fill="#7c4dd6" />
      <rect x={8} y={10} width={7} height={1} fill="#f0eafc" />
      <rect x={15} y={10} width={2} height={1} fill="#7c4dd6" />
      <rect x={17} y={10} width={7} height={1} fill="#f0eafc" />
      <rect x={24} y={10} width={2} height={1} fill="#7c4dd6" />
      <rect x={5} y={11} width={2} height={1} fill="#7c4dd6" />
      <rect x={7} y={11} width={3} height={1} fill="#f0eafc" />
      <rect x={10} y={11} width={3} height={1} fill="#7c4dd6" />
      <rect x={13} y={11} width={3} height={1} fill="#f0eafc" />
      <rect x={16} y={11} width={1} height={1} fill="#7c4dd6" />
      <rect x={17} y={11} width={2} height={1} fill="#f0eafc" />
      <rect x={19} y={11} width={3} height={1} fill="#7c4dd6" />
      <rect x={22} y={11} width={3} height={1} fill="#f0eafc" />
      <rect x={25} y={11} width={2} height={1} fill="#7c4dd6" />
      <rect x={5} y={12} width={2} height={1} fill="#7c4dd6" />
      <rect x={7} y={12} width={2} height={1} fill="#f0eafc" />
      <rect x={9} y={12} width={1} height={1} fill="#2a1b4a" />
      <rect x={10} y={12} width={1} height={1} fill="#f0eafc" />
      <rect x={11} y={12} width={1} height={1} fill="#7c4dd6" />
      <rect x={12} y={12} width={1} height={1} fill="#2a1b4a" />
      <rect x={13} y={12} width={1} height={1} fill="#7c4dd6" />
      <rect x={14} y={12} width={2} height={1} fill="#f0eafc" />
      <rect x={16} y={12} width={1} height={1} fill="#7c4dd6" />
      <rect x={17} y={12} width={1} height={1} fill="#f0eafc" />
      <rect x={18} y={12} width={1} height={1} fill="#7c4dd6" />
      <rect x={19} y={12} width={2} height={1} fill="#f0eafc" />
      <rect x={21} y={12} width={2} height={1} fill="#2a1b4a" />
      <rect x={23} y={12} width={2} height={1} fill="#f0eafc" />
      <rect x={25} y={12} width={2} height={1} fill="#7c4dd6" />
      <rect x={5} y={13} width={2} height={1} fill="#7c4dd6" />
      <rect x={7} y={13} width={2} height={1} fill="#f0eafc" />
      <rect x={9} y={13} width={1} height={1} fill="#2a1b4a" />
      <rect x={10} y={13} width={1} height={1} fill="#7c4dd6" />
      <rect x={11} y={13} width={3} height={1} fill="#2a1b4a" />
      <rect x={14} y={13} width={2} height={1} fill="#f0eafc" />
      <rect x={16} y={13} width={1} height={1} fill="#7c4dd6" />
      <rect x={17} y={13} width={1} height={1} fill="#f0eafc" />
      <rect x={18} y={13} width={2} height={1} fill="#7c4dd6" />
      <rect x={20} y={13} width={3} height={1} fill="#2a1b4a" />
      <rect x={23} y={13} width={2} height={1} fill="#f0eafc" />
      <rect x={25} y={13} width={2} height={1} fill="#7c4dd6" />
      <rect x={5} y={14} width={2} height={1} fill="#7c4dd6" />
      <rect x={7} y={14} width={2} height={1} fill="#f0eafc" />
      <rect x={9} y={14} width={4} height={1} fill="#2a1b4a" />
      <rect x={13} y={14} width={1} height={1} fill="#7c4dd6" />
      <rect x={14} y={14} width={2} height={1} fill="#f0eafc" />
      <rect x={16} y={14} width={1} height={1} fill="#7c4dd6" />
      <rect x={17} y={14} width={1} height={1} fill="#f0eafc" />
      <rect x={18} y={14} width={1} height={1} fill="#7c4dd6" />
      <rect x={19} y={14} width={4} height={1} fill="#2a1b4a" />
      <rect x={23} y={14} width={2} height={1} fill="#f0eafc" />
      <rect x={25} y={14} width={2} height={1} fill="#7c4dd6" />
      <rect x={5} y={15} width={2} height={1} fill="#7c4dd6" />
      <rect x={7} y={15} width={3} height={1} fill="#f0eafc" />
      <rect x={10} y={15} width={1} height={1} fill="#7c4dd6" />
      <rect x={11} y={15} width={1} height={1} fill="#2a1b4a" />
      <rect x={12} y={15} width={1} height={1} fill="#7c4dd6" />
      <rect x={13} y={15} width={2} height={1} fill="#f0eafc" />
      <rect x={15} y={15} width={2} height={1} fill="#7c4dd6" />
      <rect x={17} y={15} width={2} height={1} fill="#f0eafc" />
      <rect x={19} y={15} width={1} height={1} fill="#7c4dd6" />
      <rect x={20} y={15} width={2} height={1} fill="#2a1b4a" />
      <rect x={22} y={15} width={3} height={1} fill="#f0eafc" />
      <rect x={25} y={15} width={2} height={1} fill="#7c4dd6" />
      <rect x={6} y={16} width={2} height={1} fill="#7c4dd6" />
      <rect x={8} y={16} width={7} height={1} fill="#f0eafc" />
      <rect x={15} y={16} width={1} height={1} fill="#7c4dd6" />
      <rect x={16} y={16} width={1} height={1} fill="#2a1b4a" />
      <rect x={17} y={16} width={7} height={1} fill="#f0eafc" />
      <rect x={24} y={16} width={2} height={1} fill="#7c4dd6" />
      <rect x={7} y={17} width={3} height={1} fill="#7c4dd6" />
      <rect x={10} y={17} width={4} height={1} fill="#f0eafc" />
      <rect x={14} y={17} width={4} height={1} fill="#7c4dd6" />
      <rect x={18} y={17} width={4} height={1} fill="#f0eafc" />
      <rect x={22} y={17} width={3} height={1} fill="#7c4dd6" />
      <rect x={7} y={18} width={6} height={1} fill="#7c4dd6" />
      <rect x={13} y={18} width={6} height={1} fill="#f0eafc" />
      <rect x={19} y={18} width={6} height={1} fill="#7c4dd6" />
      <rect x={6} y={19} width={5} height={1} fill="#7c4dd6" />
      <rect x={11} y={19} width={10} height={1} fill="#f0eafc" />
      <rect x={21} y={19} width={5} height={1} fill="#7c4dd6" />
      <rect x={6} y={20} width={4} height={1} fill="#7c4dd6" />
      <rect x={10} y={20} width={12} height={1} fill="#f0eafc" />
      <rect x={22} y={20} width={4} height={1} fill="#7c4dd6" />
      <rect x={5} y={21} width={5} height={1} fill="#7c4dd6" />
      <rect x={10} y={21} width={12} height={1} fill="#f0eafc" />
      <rect x={22} y={21} width={5} height={1} fill="#7c4dd6" />
      <rect x={5} y={22} width={5} height={1} fill="#7c4dd6" />
      <rect x={10} y={22} width={12} height={1} fill="#f0eafc" />
      <rect x={22} y={22} width={5} height={1} fill="#7c4dd6" />
      <rect x={5} y={23} width={5} height={1} fill="#7c4dd6" />
      <rect x={10} y={23} width={13} height={1} fill="#f0eafc" />
      <rect x={23} y={23} width={4} height={1} fill="#7c4dd6" />
      <rect x={6} y={24} width={4} height={1} fill="#7c4dd6" />
      <rect x={10} y={24} width={13} height={1} fill="#f0eafc" />
      <rect x={23} y={24} width={3} height={1} fill="#7c4dd6" />
      <rect x={7} y={25} width={3} height={1} fill="#7c4dd6" />
      <rect x={10} y={25} width={12} height={1} fill="#f0eafc" />
      <rect x={22} y={25} width={3} height={1} fill="#7c4dd6" />
      <rect x={8} y={26} width={3} height={1} fill="#7c4dd6" />
      <rect x={11} y={26} width={10} height={1} fill="#f0eafc" />
      <rect x={21} y={26} width={3} height={1} fill="#7c4dd6" />
      <rect x={9} y={27} width={3} height={1} fill="#7c4dd6" />
      <rect x={12} y={27} width={2} height={1} fill="#2a1b4a" />
      <rect x={14} y={27} width={4} height={1} fill="#f0eafc" />
      <rect x={18} y={27} width={2} height={1} fill="#2a1b4a" />
      <rect x={20} y={27} width={3} height={1} fill="#7c4dd6" />
      <rect x={10} y={28} width={5} height={1} fill="#2a1b4a" />
      <rect x={17} y={28} width={5} height={1} fill="#2a1b4a" />
      <rect x={10} y={29} width={3} height={1} fill="#2a1b4a" />
      <rect x={14} y={29} width={1} height={1} fill="#2a1b4a" />
      <rect x={17} y={29} width={1} height={1} fill="#2a1b4a" />
      <rect x={19} y={29} width={3} height={1} fill="#2a1b4a" />
    </svg>
  );
}
