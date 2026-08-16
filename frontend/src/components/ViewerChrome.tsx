// ViewerChrome（SDD 04 §7.1 / §6.3）——三查看器统一外壳：工具按钮 + 工具选项条 + CT 窗位预设。
// 全部真相源：注册表（tv.tools / tv.capabilities）+ store.tool/toolOptions；
// 无内联样式（.chrome-* 样式族），无硬编码文案（i18n），查看器内不再挂私有浮动条。
import { useMemo } from "react";

import { useI18n } from "../i18n";
import { useSession, type Tool } from "../store/session";
import type { ClassSpec, Primitive } from "../api/types";

// CT 标准窗宽窗位预设（HU）——医学常识常数；标签走 i18n（chrome_preset_*）。
const CT_PRESETS = [
  { key: "abd", i18n: "chrome_preset_abd", ww: 400, wl: 40 },
  { key: "med", i18n: "chrome_preset_med", ww: 350, wl: 40 },
  { key: "lung", i18n: "chrome_preset_lung", ww: 1500, wl: -600 },
  { key: "bone", i18n: "chrome_preset_bone", ww: 1800, wl: 400 },
] as const;

type VolMaskPrim = Extract<Primitive, { kind: "volume_mask" }>;

export function ViewerChrome({ onTool }: { onTool: (id: Tool) => void }) {
  const { t, lang } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const tool = useSession((s) => s.tool);
  const toolOptions = useSession((s) => s.toolOptions);
  const setToolOptions = useSession((s) => s.setToolOptions);
  const primitives = useSession((s) => s.primitives);

  const tv = tasks.find((tk) => tk.modality === modality);
  // 工具按钮 = 注册表 tools × 引擎能力位过滤（WSI 无 brush；bbox/polygon 按能力位）
  const tools = useMemo(() => {
    const caps = new Set(tv?.capabilities ?? []);
    return (tv?.tools ?? []).filter((tl) => {
      if (tl.id === "bbox" || tl.id === "polygon" || tl.id === "brush") return caps.has(tl.id);
      return true; // cursor/reset 恒在
    });
  }, [tv]);

  // brush 的 class 列表：来自当前 volume_mask 产物（CT 分割类）；无则隐藏选择器
  const classes = useMemo<ClassSpec[]>(() => {
    const vol = primitives.find((p): p is VolMaskPrim => p.kind === "volume_mask");
    return vol?.classes ?? [];
  }, [primitives]);

  const { brush, voi } = toolOptions;
  const isCt = modality === "ct_abdomen";
  const hintKey = tool === "bbox" ? "chrome_hint_bbox" : tool === "polygon" ? "chrome_hint_polygon" : null;

  return (
    <>
      <div className="etools" role="toolbar">
        {tools.map((tl) => (
          <button key={tl.id} className="etool" aria-pressed={tool === tl.id} onClick={() => onTool(tl.id as Tool)}>
            {tl.glyph}
            <span className="tip">{tl.label[lang]}</span>
          </button>
        ))}
      </div>

      {/* 选项条（顶部居中）：绘制提示 / brush 参数 / CT 窗位——按工具与模态分段出现 */}
      {(hintKey || tool === "brush" || isCt) && (
        <div className="chrome-options">
          {hintKey && <span className="chrome-hint">{t(hintKey)}</span>}

          {tool === "brush" && (
            <div className="chrome-seg">
              <button
                className="chrome-btn"
                aria-pressed={brush.mode === "paint"}
                onClick={() => setToolOptions({ brush: { mode: "paint" } })}
              >
                {t("chrome_brush_paint")}
              </button>
              <button
                className="chrome-btn"
                aria-pressed={brush.mode === "erase"}
                onClick={() => setToolOptions({ brush: { mode: "erase" } })}
              >
                {t("chrome_brush_erase")}
              </button>
              {classes.length > 0 && (
                <select
                  className="chrome-select"
                  value={brush.classId}
                  onChange={(e) => setToolOptions({ brush: { classId: Number(e.target.value) } })}
                >
                  {classes.map((c) => (
                    <option key={c.class_id} value={c.class_id}>
                      {c.label[lang]}
                    </option>
                  ))}
                </select>
              )}
              <label className="chrome-range">
                {t("chrome_brush_radius")} {brush.radius}
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={brush.radius}
                  onChange={(e) => setToolOptions({ brush: { radius: Number(e.target.value) } })}
                />
              </label>
            </div>
          )}

          {isCt && (
            <div className="chrome-seg">
              {CT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className="chrome-btn"
                  aria-pressed={voi.ww === p.ww && voi.wl === p.wl}
                  onClick={() => setToolOptions({ voi: { ww: p.ww, wl: p.wl } })}
                  title={`WW ${p.ww} / WL ${p.wl}`}
                >
                  {t(p.i18n)}
                </button>
              ))}
              <span className="chrome-sep" />
              <label className="chrome-range">
                WW
                <input
                  type="range"
                  min={1}
                  max={3000}
                  step={10}
                  value={voi.ww}
                  onChange={(e) => setToolOptions({ voi: { ww: Number(e.target.value) } })}
                />
                <span className="mono">{voi.ww}</span>
              </label>
              <label className="chrome-range">
                WL
                <input
                  type="range"
                  min={-1000}
                  max={1000}
                  step={10}
                  value={voi.wl}
                  onChange={(e) => setToolOptions({ voi: { wl: Number(e.target.value) } })}
                />
                <span className="mono">{voi.wl}</span>
              </label>
            </div>
          )}
        </div>
      )}
    </>
  );
}
