// 等宽泳道时间线（SDD 21 §7.5）：每条记录占一个单位，按记录表顺序排在输入 / 模型 / 工具三条泳道。
import type { Trajectory, TrajectoryItem } from "../../../agent/runtime/types";
import { useI18n, type I18nKey } from "../../../i18n";
import { LANES, laneOf, summaryOf } from "./format";

function isWarning(item: TrajectoryItem): boolean {
  if (item.kind === "tool") return item.blocked || item.is_error;
  if (item.kind === "model") return item.stop_reason === "error" || item.stop_reason === "aborted";
  return false;
}

export function Timeline({ trajectory, onJump }: { trajectory: Trajectory; onJump: (item: TrajectoryItem) => void }) {
  const { t } = useI18n();
  const cells = trajectory.turns.flatMap((turn) => turn.items.map((item, index) => ({ item, turn: turn.index, start: index === 0 })));
  if (!cells.length) return null;
  return (
    <div className="traj-timeline" role="group" aria-label={t("traj_timeline")}>
      <div className="traj-lane-labels" aria-hidden="true">
        {LANES.map((lane) => <span key={lane}>{t(`traj_lane_${lane}` as I18nKey)}</span>)}
      </div>
      <div className="traj-lanes-scroll">
        <div className="traj-lanes" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(8px, 1fr))` }}>
          {cells.map(({ item, turn, start }, column) => {
            const lane = laneOf(item);
            const label = `${t(`traj_kind_${item.kind}` as I18nKey)}: ${summaryOf(t, item, trajectory.headers)}`;
            return [
              start && (
                <span
                  key={`turn-${turn}`}
                  className="traj-turn-mark"
                  style={{ gridColumn: column + 1, gridRow: "1 / span 3" }}
                  aria-hidden="true"
                >
                  {turn}
                </span>
              ),
              <button
                key={item.item_id}
                type="button"
                className={`traj-block traj-lane-${lane}${isWarning(item) ? " warn" : ""}`}
                style={{ gridColumn: column + 1, gridRow: LANES.indexOf(lane) + 1 }}
                title={label}
                aria-label={label}
                data-item={item.item_id}
                onClick={() => onJump(item)}
              />,
            ];
          })}
        </div>
      </div>
    </div>
  );
}
