/** SDD 11：一次视频问答的观察预算、证据事实源和会话记录。 */
import { createHash } from "node:crypto";

import type { Session } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../atlas/client.js";
import type { ClipObservation, EvidenceRef, VideoAnswer, VideoInterval } from "../contracts.js";
import { RuntimeError } from "../errors.js";
import type { VideoMediaBridge } from "./model-runtime.js";

interface VideoObjectMeta {
  id: string;
  kind: string;
  axes: { name: string; size: number }[];
  meta: { duration_ms?: unknown };
  resources: { clip?: string };
  streams: { kind: string }[];
}

interface ClipHeader {
  object_id: string;
  source_sha256: string;
  requested_interval: VideoInterval;
  actual_interval: VideoInterval;
  mime: string;
  clip_sha256: string;
  encoding: Record<string, unknown>;
}

const MAX_CALLS = 12;
const MAX_DURATION_MS = 600_000;
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_CLIP_BYTES = 6 * 1024 * 1024;

function interval(raw: unknown): raw is VideoInterval {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as VideoInterval;
  return Number.isInteger(value.start_ms) && Number.isInteger(value.end_ms)
    && value.start_ms >= 0 && value.end_ms > value.start_ms;
}

function validHeader(raw: unknown, objectId: string): raw is ClipHeader {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as ClipHeader;
  return value.object_id === objectId && /^[0-9a-f]{64}$/u.test(value.source_sha256)
    && /^[0-9a-f]{64}$/u.test(value.clip_sha256)
    && interval(value.requested_interval) && interval(value.actual_interval)
    && value.mime === "video/mp4" && Boolean(value.encoding);
}

export class VideoTurn {
  private readonly observations = new Map<string, ClipObservation>();
  private calls = 0;
  private durationMs = 0;
  private bytes = 0;
  private sourceSha256: string | null = null;
  private answerSubmitted = false;
  private meta: VideoObjectMeta | null = null;
  private readonly base = backendBaseUrl().replace(/\/+$/u, "");

  constructor(
    readonly objectId: string,
    readonly commandId: string,
    private readonly session: Session,
    private readonly media: VideoMediaBridge,
    private readonly emitAnswer: (answer: VideoAnswer) => void,
  ) {}

  private async object(signal?: AbortSignal): Promise<VideoObjectMeta> {
    if (this.meta) return this.meta;
    const response = await fetch(`${this.base}/objects/${encodeURIComponent(this.objectId)}`, signal ? { signal } : {});
    if (!response.ok) throw new RuntimeError("video_unavailable", `无法读取视频对象：HTTP ${response.status}`, 502);
    const meta = await response.json() as VideoObjectMeta;
    if (meta.id !== this.objectId || meta.kind !== "video" || !meta.resources?.clip
      || !Number.isInteger(Number(meta.meta?.duration_ms)) || Number(meta.meta.duration_ms) <= 0) {
      throw new RuntimeError("video_unavailable", "视频对象缺少可用的区间资源或时长", 422);
    }
    if (Number(meta.meta.duration_ms) > MAX_DURATION_MS) {
      throw new RuntimeError("video_duration_exceeded", "视频超过 10 分钟，本功能暂不支持", 422);
    }
    this.meta = meta;
    return meta;
  }

  async describe(): Promise<{ duration_ms: number; has_audio: boolean }> {
    const meta = await this.object();
    return { duration_ms: Number(meta.meta.duration_ms), has_audio: meta.streams.some((s) => s.kind === "audio") };
  }

  async observe(startMs: number, endMs: number, fps: 0.5 | 2 | 5, signal?: AbortSignal): Promise<ClipObservation> {
    const meta = await this.object(signal);
    const duration = Number(meta.meta.duration_ms);
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs
      || endMs > duration || endMs - startMs > 60_000) {
      throw new RuntimeError("invalid_video_interval", `请选择 0..${duration} ms 内、不超过 60000 ms 的区间`, 422);
    }
    if (![0.5, 2, 5].includes(fps)) throw new RuntimeError("invalid_video_fps", "fps 只能是 0.5、2 或 5", 422);
    if (this.calls >= MAX_CALLS || this.durationMs + endMs - startMs > MAX_DURATION_MS) {
      throw new RuntimeError("observation_budget_exceeded", "本轮视频观察次数或总时长已用尽", 413);
    }
    this.calls++;
    this.durationMs += endMs - startMs;
    const template = meta.resources.clip;
    if (!template) throw new RuntimeError("video_unavailable", "视频对象缺少区间资源", 422);
    const resource = template
      .replace("{start_ms}", String(startMs)).replace("{end_ms}", String(endMs));
    const url = new URL(resource, this.base);
    if (url.origin !== new URL(this.base).origin) throw new RuntimeError("video_clip_failed", "片段资源指向了非后端地址", 502);
    const timeout = AbortSignal.timeout(120_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, { signal: combined });
    if (!response.ok) throw new RuntimeError("video_clip_failed", `生成视频片段失败：HTTP ${response.status}`, response.status);
    let header: unknown;
    try { header = JSON.parse(response.headers.get("X-Glaux-Clip") ?? ""); } catch {
      throw new RuntimeError("video_clip_failed", "片段缺少有效时间映射", 502);
    }
    if (!validHeader(header, this.objectId)) throw new RuntimeError("video_clip_failed", "片段元数据无效", 502);
    if (this.sourceSha256 && this.sourceSha256 !== header.source_sha256) {
      throw new RuntimeError("video_source_changed", "视频源在问答过程中发生变化", 409);
    }
    if (header.requested_interval.start_ms !== startMs || header.requested_interval.end_ms !== endMs
      || header.actual_interval.start_ms < startMs || header.actual_interval.end_ms > endMs) {
      throw new RuntimeError("video_clip_failed", "片段时间映射超出请求区间", 502);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_CLIP_BYTES || this.bytes + bytes.byteLength > MAX_BYTES) {
      throw new RuntimeError("observation_budget_exceeded", "片段或本轮媒体字节预算已用尽，请缩短区间", 413);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== header.clip_sha256) throw new RuntimeError("video_clip_failed", "片段摘要与时间映射不一致", 502);
    const observationId = createHash("sha256").update(JSON.stringify({
      source: header.source_sha256, actual: header.actual_interval, encoding: header.encoding, fps,
    })).digest("hex");
    const observation: ClipObservation = {
      observation_id: observationId,
      object_id: this.objectId,
      source_sha256: header.source_sha256,
      requested_interval: header.requested_interval,
      actual_interval: header.actual_interval,
      mime: "video/mp4",
      clip_sha256: digest,
      encoding: header.encoding,
      fps,
    };
    this.bytes += bytes.byteLength;
    this.sourceSha256 = header.source_sha256;
    const alreadyObserved = this.observations.has(observationId);
    this.observations.set(observationId, observation);
    this.media.register(observationId, bytes, fps);
    if (!alreadyObserved) {
      await this.session.appendCustomEntry("glaux.video.observation", {
        command_id: this.commandId, ...observation,
      });
    }
    return observation;
  }

  async submit(answer: VideoAnswer): Promise<void> {
    if (this.answerSubmitted) throw new RuntimeError("video_answer_exists", "本轮已经提交视频回答", 409);
    if (answer.object_id !== this.objectId || !Array.isArray(answer.claims) || !Array.isArray(answer.unanswered)
      || (!answer.claims.length && !answer.unanswered.length)) {
      throw new RuntimeError("invalid_video_answer", "视频回答缺少对象、结论或无法判断项", 422);
    }
    const meta = await this.object();
    const width = meta.axes.find((axis) => axis.name === "x")?.size ?? 0;
    const height = meta.axes.find((axis) => axis.name === "y")?.size ?? 0;
    const hasAudio = meta.streams.some((stream) => stream.kind === "audio");
    for (const claim of answer.claims) {
      if (!claim.text?.trim() || !Array.isArray(claim.evidence) || !claim.evidence.length) {
        throw new RuntimeError("invalid_video_answer", "每条事实都需要文字和至少一项证据", 422);
      }
      for (const evidence of claim.evidence) await this.validateEvidence(evidence, width, height, hasAudio);
    }
    if (answer.unanswered.some((item) => typeof item !== "string" || !item.trim())) {
      throw new RuntimeError("invalid_video_answer", "无法判断项必须是非空文字", 422);
    }
    await this.session.appendCustomEntry("glaux.video.answer", {
      command_id: this.commandId, answer,
    });
    this.answerSubmitted = true;
    this.emitAnswer(answer);
  }

  async finalize(): Promise<void> {
    if (this.answerSubmitted || this.calls === 0) return;
    await this.submit({
      object_id: this.objectId,
      claims: [],
      unanswered: ["本轮没有提交带证据的结论，上方回答未经证据校验"],
    });
  }

  private async validateEvidence(evidence: EvidenceRef, width: number, height: number, hasAudio: boolean): Promise<void> {
    const observed = this.observations.get(evidence.observation_id);
    if (!observed || observed.object_id !== this.objectId || observed.source_sha256 !== this.sourceSha256
      || !interval(evidence.source_interval)
      || evidence.source_interval.start_ms < observed.actual_interval.start_ms
      || evidence.source_interval.end_ms > observed.actual_interval.end_ms) {
      throw new RuntimeError("invalid_video_evidence", "引用不属于本轮已观察的视频区间", 422);
    }
    if (!["visual", "audio", "av"].includes(evidence.kind) || (!hasAudio && evidence.kind !== "visual")) {
      throw new RuntimeError("invalid_video_evidence", "引用的音画类型与源视频不符", 422);
    }
    if (evidence.region) {
      const r = evidence.region;
      if (evidence.kind === "audio" || r.kind !== "box" || ![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)
        || !(0 <= r.x0 && r.x0 < r.x1 && r.x1 <= width && 0 <= r.y0 && r.y0 < r.y1 && r.y1 <= height)
        || typeof evidence.frame_time_ms !== "number" || !Number.isInteger(evidence.frame_time_ms)
        || evidence.frame_time_ms! < evidence.source_interval.start_ms
        || evidence.frame_time_ms! >= evidence.source_interval.end_ms) {
        throw new RuntimeError("invalid_video_evidence", "关键帧时间或对象坐标区域无效", 422);
      }
      const url = new URL(`${this.base}/objects/${encodeURIComponent(this.objectId)}/frame-at`);
      url.searchParams.set("time_ms", String(evidence.frame_time_ms));
      url.searchParams.set("source_sha256", observed.source_sha256);
      const response = await fetch(url);
      if (!response.ok) throw new RuntimeError("invalid_video_evidence", `关键帧不可复核：HTTP ${response.status}`, 422);
      let reference: { origin?: unknown; scale?: unknown; width?: unknown; height?: unknown } | null;
      try { reference = JSON.parse(response.headers.get("X-Glaux-Frame") ?? "null"); } catch { reference = null; }
      const actualTime = Number(response.headers.get("X-Glaux-Frame-Time"));
      const tolerance = Number(response.headers.get("X-Glaux-Frame-Tolerance"));
      if (!reference || !Array.isArray(reference.origin) || reference.origin.length !== 2
        || !reference.origin.every(Number.isFinite) || typeof reference.scale !== "number" || reference.scale <= 0
        || typeof reference.width !== "number" || typeof reference.height !== "number"
        || !Number.isFinite(actualTime) || !Number.isFinite(tolerance) || tolerance < 100
        || Math.abs(actualTime - evidence.frame_time_ms!) > tolerance) {
        throw new RuntimeError("invalid_video_evidence", "关键帧时间或坐标参照无效", 422);
      }
      const [ox, oy] = reference.origin as [number, number];
      const right = ox + reference.width / reference.scale;
      const bottom = oy + reference.height / reference.scale;
      if (r.x0 < ox || r.y0 < oy || r.x1 > right || r.y1 > bottom) {
        throw new RuntimeError("invalid_video_evidence", "区域不在关键帧覆盖范围内", 422);
      }
    } else if (evidence.frame_time_ms !== undefined) {
      throw new RuntimeError("invalid_video_evidence", "关键帧时间必须与区域一起提交", 422);
    }
  }
}
