// 변환 파이프라인 오케스트레이터 — inline(after 훅)·Inngest 공용 (순수 로직, vitest 대상)
// step 러너만 바꿔 끼운다: inline = 바로 실행, Inngest = step.run (단계별 재시도·메모이즈)
// 단계 간 데이터는 JSON 직렬화 가능해야 함 (Inngest step 반환값) — 오디오 바이트는 Storage 경유
import type { Transcript, TranscriptSegment } from "../stt/types";

export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface PipelineContext {
  videoId: string;
  projectId: string;
  ownerId: string;
  plan: string;
  storagePath: string;
  isText: boolean;
  /** 재시도 시 트랜스크립트가 이미 있으면 STT 단계를 건너뜀 (재과금 방지) */
  hasTranscript: boolean;
  hasKeyframes: boolean;
}

export interface AudioChunk {
  path: string;
  offsetSeconds: number;
}

export interface ChunkTranscript {
  segments: TranscriptSegment[];
  language: string;
  source: Transcript["source"];
}

export interface PipelineSteps {
  /** 처리 대상이 아니면 null (이미 처리 중·완료) */
  prepare(videoId: string): Promise<PipelineContext | null>;
  saveTextTranscript(ctx: PipelineContext): Promise<void>;
  extractAudio(ctx: PipelineContext): Promise<AudioChunk[]>;
  transcribeChunk(ctx: PipelineContext, chunk: AudioChunk, index: number, total: number): Promise<ChunkTranscript>;
  saveTranscript(ctx: PipelineContext, parts: ChunkTranscript[]): Promise<void>;
  /** non-fatal (내부에서 실패 흡수) */
  extractKeyframes(ctx: PipelineContext): Promise<void>;
  structure(ctx: PipelineContext): Promise<{ documentId: string }>;
  /** non-fatal */
  matchKeyframes(ctx: PipelineContext, documentId: string): Promise<void>;
  /** non-fatal */
  enrich(ctx: PipelineContext, documentId: string): Promise<void>;
  finish(ctx: PipelineContext): Promise<void>;
}

export async function runPipeline(
  videoId: string,
  run: StepRunner,
  steps: PipelineSteps
): Promise<"done" | "skipped"> {
  const ctx = await run("prepare", () => steps.prepare(videoId));
  if (!ctx) return "skipped";

  if (!ctx.hasTranscript) {
    if (ctx.isText) {
      await run("save-transcript", () => steps.saveTextTranscript(ctx));
    } else {
      const chunks = await run("extract-audio", () => steps.extractAudio(ctx));
      const parts: ChunkTranscript[] = [];
      for (let i = 0; i < chunks.length; i++) {
        parts.push(await run(`stt-${i + 1}`, () => steps.transcribeChunk(ctx, chunks[i], i, chunks.length)));
      }
      await run("save-transcript", () => steps.saveTranscript(ctx, parts));
    }
  }

  if (!ctx.isText && !ctx.hasKeyframes) {
    await run("keyframes", () => steps.extractKeyframes(ctx));
  }
  const { documentId } = await run("structure", () => steps.structure(ctx));
  if (!ctx.isText) await run("match-keyframes", () => steps.matchKeyframes(ctx, documentId));
  await run("enrich", () => steps.enrich(ctx, documentId));
  await run("finish", () => steps.finish(ctx));
  return "done";
}

/** 단계별 소요 시간 로그 (Inngest에서는 실제 실행될 때만 찍힘 — 메모이즈된 단계는 제외) */
export function timedRunner(run: StepRunner, videoId: string): StepRunner {
  return (name, fn) =>
    run(name, async () => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        console.log(`[pipeline-timing] ${JSON.stringify({ videoId, step: name, ms: Date.now() - started })}`);
      }
    });
}

/** Inngest idempotency 키 — 최초 업로드는 영상당 1회, 재시도는 매번 새 키 (중복 클릭은 조건부 update로 차단) */
export function runKeyFor(videoId: string, kind: "initial" | "retry", now: number = Date.now()): string {
  return kind === "initial" ? `${videoId}:initial` : `${videoId}:retry-${now}`;
}
