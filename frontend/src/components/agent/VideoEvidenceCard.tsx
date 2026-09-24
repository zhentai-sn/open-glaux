import { useEffect, useState } from "react";

import type { ClipObservation, EvidenceRef, VideoAnswerRecord } from "../../agent/runtime/types";
import type { ObjectMeta } from "../../api/types";
import { useI18n } from "../../i18n";

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface ActiveClip {
  url: string;
  actualStartMs: number;
  evidence: EvidenceRef;
  frameUrl?: string;
  frame?: { origin: [number, number]; scale: number; width: number; height: number };
}

export function VideoEvidenceCard({
  record,
  observations,
}: {
  record: VideoAnswerRecord;
  observations: ClipObservation[];
}) {
  const { lang } = useI18n();
  const [active, setActive] = useState<ActiveClip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (active) {
      URL.revokeObjectURL(active.url);
      if (active.frameUrl) URL.revokeObjectURL(active.frameUrl);
    }
  }, [active]);

  const openEvidence = async (evidence: EvidenceRef) => {
    const observation = observations.find((item) => item.observation_id === evidence.observation_id);
    if (!observation || observation.object_id !== record.answer.object_id) {
      setError(lang === "zh" ? "观测记录不可用" : "Observation record unavailable");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const metaResponse = await fetch(`/api/objects/${encodeURIComponent(record.answer.object_id)}`);
      if (!metaResponse.ok) throw new Error("source unavailable");
      const meta = await metaResponse.json() as ObjectMeta;
      if (!meta.resources.clip) throw new Error("clip resource unavailable");
      const path = meta.resources.clip
        .replace("{start_ms}", String(observation.requested_interval.start_ms))
        .replace("{end_ms}", String(observation.requested_interval.end_ms));
      const clipUrl = new URL(`/api${path}`, window.location.origin);
      clipUrl.searchParams.set("source_sha256", observation.source_sha256);
      const clipResponse = await fetch(clipUrl);
      if (!clipResponse.ok) throw new Error(`HTTP ${clipResponse.status}`);
      const header = JSON.parse(clipResponse.headers.get("X-Glaux-Clip") ?? "null") as { source_sha256?: string; actual_interval?: { start_ms?: number } } | null;
      if (header?.source_sha256 !== observation.source_sha256 || !Number.isInteger(Number(header.actual_interval?.start_ms))) {
        throw new Error("clip source mismatch");
      }
      const clipBlob = await clipResponse.blob();
      let frameBlob: Blob | undefined;
      let frame: ActiveClip["frame"];
      if (evidence.region && evidence.frame_time_ms !== undefined) {
        const stillUrl = new URL(`/api/objects/${encodeURIComponent(record.answer.object_id)}/frame-at`, window.location.origin);
        stillUrl.searchParams.set("time_ms", String(evidence.frame_time_ms));
        stillUrl.searchParams.set("source_sha256", observation.source_sha256);
        const stillResponse = await fetch(stillUrl);
        if (!stillResponse.ok) throw new Error(`HTTP ${stillResponse.status}`);
        frame = JSON.parse(stillResponse.headers.get("X-Glaux-Frame") ?? "null") as ActiveClip["frame"];
        if (!frame || !Array.isArray(frame.origin) || !Number.isFinite(frame.scale) || frame.scale <= 0) throw new Error("invalid frame");
        frameBlob = await stillResponse.blob();
      }
      const url = URL.createObjectURL(clipBlob);
      const frameUrl = frameBlob ? URL.createObjectURL(frameBlob) : undefined;
      setActive({ url, actualStartMs: header.actual_interval!.start_ms!, evidence, ...(frameUrl ? { frameUrl, frame } : {}) });
    } catch {
      setError(lang === "zh" ? "源视频不可用或已变化，无法回放这条证据" : "Source video unavailable or changed; this evidence cannot be replayed");
    } finally {
      setLoading(false);
    }
  };

  const region = active?.evidence.region;
  const frame = active?.frame;
  const overlay = region && frame ? {
    left: `${(region.x0 - frame.origin[0]) * frame.scale / frame.width * 100}%`,
    top: `${(region.y0 - frame.origin[1]) * frame.scale / frame.height * 100}%`,
    width: `${(region.x1 - region.x0) * frame.scale / frame.width * 100}%`,
    height: `${(region.y1 - region.y0) * frame.scale / frame.height * 100}%`,
  } : undefined;

  return (
    <section className="video-evidence-card" aria-label={lang === "zh" ? "视频证据回答" : "Cited video answer"}>
      <b>{lang === "zh" ? "视频证据" : "Video evidence"}</b>
      {record.answer.claims.map((claim, index) => (
        <div className="video-evidence-claim" key={`${record.command_id}-${index}`}>
          <p>{claim.text}</p>
          <div className="video-evidence-links">
            {claim.evidence.map((evidence, i) => (
              <button type="button" key={`${evidence.observation_id}-${i}`} disabled={loading} onClick={() => void openEvidence(evidence)}>
                {clock(evidence.source_interval.start_ms)}–{clock(evidence.source_interval.end_ms)} · {evidence.kind}
              </button>
            ))}
          </div>
        </div>
      ))}
      {record.answer.unanswered.map((item, i) => (
        <p className="video-evidence-unanswered" key={`${record.command_id}-unknown-${i}`}>
          {lang === "zh" ? "无法判断：" : "Cannot determine: "}{item}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
      {active && <div className="video-evidence-player">
        <div>{clock(active.evidence.source_interval.start_ms)}–{clock(active.evidence.source_interval.end_ms)}</div>
        <video
          controls
          src={active.url}
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = Math.max(0, (active.evidence.source_interval.start_ms - active.actualStartMs) / 1000);
          }}
          onTimeUpdate={(event) => {
            if (event.currentTarget.currentTime >= (active.evidence.source_interval.end_ms - active.actualStartMs) / 1000) event.currentTarget.pause();
          }}
        />
        {active.frameUrl && overlay && <div className="video-evidence-frame">
          <img src={active.frameUrl} alt={lang === "zh" ? "证据关键帧" : "Evidence frame"} />
          <span className="video-evidence-region" style={overlay} />
        </div>}
      </div>}
    </section>
  );
}
