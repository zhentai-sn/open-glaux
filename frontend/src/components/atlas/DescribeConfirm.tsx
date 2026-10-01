import { useEffect, useState } from "react";

import { atlasApi } from "../../api/atlas";
import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { connectionTarget, connectionUsable, runDescribeQueue } from "./describe";

// 生成描述的确认条（SDD feats/03 §6.1、D-28）：列出待描述案例数与发送目标，用户点「生成描述」才发图；
// 「暂不」只对当前这组案例生效，集合变化（新上传、改 ROI）后重新出现。确认不记忆、不跨连接。
export function DescribeConfirm() {
  const { t } = useI18n();
  const connection = useSession((s) => s.connection);
  const refreshTick = useAtlasUi((s) => s.refreshTick);
  const job = useAtlasUi((s) => s.describeJob);
  const dismissed = useAtlasUi((s) => s.describeDismissed);
  const dismiss = useAtlasUi((s) => s.dismissDescribe);
  const setJob = useAtlasUi((s) => s.setDescribeJob);
  const [pending, setPending] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    atlasApi
      .list({ status: "active", describe_status: "pending", limit: 500 })
      .then((rows) => alive && setPending(rows.map((r) => r.exemplar_id)))
      .catch(() => alive && setPending([]));
    return () => {
      alive = false;
    };
  }, [refreshTick]);

  if (job?.running) {
    return (
      <div className="atlas-describe-bar" role="status" data-testid="describe-progress">
        <Icon icon={ICONS.spinner} size="sm" className="spin" /> {t("atlas_describe_progress", { done: job.done, total: job.total })}
      </div>
    );
  }
  if (job) {
    return (
      <div className="atlas-describe-bar" role="status">
        <span>{t("atlas_describe_done", { ok: job.ok, failed: job.failed })}</span>
        <button type="button" className="atlas-link" onClick={() => setJob(null)}>
          {t("atlas_close")}
        </button>
      </div>
    );
  }
  if (pending.length === 0) return null;
  const key = [...pending].sort().join(",");
  if (!connectionUsable(connection)) {
    return (
      <div className="atlas-describe-bar muted" data-testid="describe-need-model">
        {t("atlas_describe_need_model", { n: pending.length })}
      </div>
    );
  }
  if (dismissed === key) return null;
  return (
    <div className="atlas-describe-bar" data-testid="describe-confirm">
      <span>{t("atlas_describe_confirm", { n: pending.length, target: connectionTarget(connection) })}</span>
      <span className="atlas-actions">
        <button type="button" className="dsbtn" onClick={() => void runDescribeQueue(pending, connection)}>
          {t("atlas_describe_go")}
        </button>
        <button type="button" className="atlas-btn" onClick={() => dismiss(key)}>
          {t("atlas_describe_later")}
        </button>
      </span>
    </div>
  );
}
