import "server-only";
import { createAdminClient } from "../supabase/admin";
import { parseTranscriptText, transcriptToPromptText } from "../stt/parse-txt";
import { getSttProvider } from "../stt";
import {
  CHUNK_DURATION_SECONDS,
  applyOffset,
  extractAudio,
  probeDurationSeconds,
  splitAudio,
} from "../audio/processor";
import { structureTranscript } from "../ai/structure";
import { generateEnrichQuestions } from "../ai/enrich";
import { extractKeyframes } from "../keyframes/extract";
import { matchKeyframesToSteps } from "../keyframes/match";
import { maskDeep } from "../privacy/mask";
import { checkUploadAllowed } from "../plan";
import { getPlanUsage } from "../usage";
import { UserFacingError } from "../errors";
import type { HandoverDocument } from "../ai/schema";
import type { Transcript, TranscriptSegment } from "../stt/types";
import type { AudioChunk, PipelineSteps } from "./run";

// 파이프라인 단계 구현 (기존 processVideo 로직을 단계로 분리 — 상태머신 uploaded→transcribing→structuring→done/failed 유지)
// 세부 단계(stage)는 표시용 보조 컬럼(0009). 컬럼이 없으면 무시 — 배포 순서 사고 방지

type Admin = ReturnType<typeof createAdminClient>;

const isTextPath = (p: string) => p.endsWith(".txt") || p.endsWith(".md");
const audioDir = (storagePath: string) => `${storagePath}.audio`;

async function setStatus(db: Admin, videoId: string, status: string, errorMessage: string | null = null) {
  const { error } = await db.from("videos").update({ status, error_message: errorMessage }).eq("id", videoId);
  if (error) throw new Error(`상태 갱신 실패 (${status}): ${error.message}`);
}

async function setStage(db: Admin, videoId: string, stage: string | null) {
  await db.from("videos").update({ stage }).eq("id", videoId); // 0009 미적용이면 에러 — 무시
}

async function download(db: Admin, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from("videos").download(path);
  if (error || !data) {
    throw new UserFacingError("영상 파일을 불러올 수 없습니다. 다시 업로드하거나 잠시 후 시도하세요.");
  }
  return Buffer.from(await data.arrayBuffer());
}

/** 임시 오디오 청크 삭제 (성공·실패 모든 경로에서 호출, 실패해도 cron이 하루 뒤 정리) */
export async function cleanupAudioChunks(storagePath: string): Promise<void> {
  try {
    const db = createAdminClient();
    const dir = audioDir(storagePath);
    const { data } = await db.storage.from("videos").list(dir);
    if (data && data.length > 0) {
      await db.storage.from("videos").remove(data.map((f) => `${dir}/${f.name}`));
    }
  } catch (e) {
    console.error(`[pipeline] 임시 오디오 청크 삭제 실패 (cron이 정리): ${storagePath}`, e);
  }
}

/** 최종 실패 기록 — 사용자용 문구만 저장, stage는 실패 지점 표시용으로 유지 */
export async function recordFailure(videoId: string, userMessage: string): Promise<void> {
  const db = createAdminClient();
  await db.from("videos").update({ status: "failed", error_message: userMessage }).eq("id", videoId);
  const { data } = await db.from("videos").select("storage_path").eq("id", videoId).single();
  if (data?.storage_path) await cleanupAudioChunks(data.storage_path);
}

export async function getVideoStatus(
  videoId: string
): Promise<{ status: string; error_message: string | null; storage_path: string } | null> {
  const { data } = await createAdminClient()
    .from("videos")
    .select("status, error_message, storage_path")
    .eq("id", videoId)
    .single();
  return data;
}

export const pipelineSteps: PipelineSteps = {
  async prepare(videoId) {
    const db = createAdminClient();
    const { data: video, error } = await db
      .from("videos")
      .select("id, project_id, storage_path, status")
      .eq("id", videoId)
      .single();
    if (error || !video) {
      console.error(`[pipeline] video 조회 실패: ${videoId}`, error);
      return null;
    }
    if (video.status !== "uploaded") {
      console.warn(`[pipeline] 이미 처리됨/처리 중 (status=${video.status}): ${videoId}`);
      return null;
    }
    const { data: project } = await db
      .from("projects")
      .select("owner_id, plan")
      .eq("id", video.project_id)
      .single();
    if (!project) throw new Error(`project 없음: ${video.project_id}`);
    // 방어: 경로가 소유자·프로젝트 폴더가 아니면 처리 거부 (타인 파일 처리 방지)
    if (!video.storage_path.startsWith(`${project.owner_id}/${video.project_id}/`)) {
      throw new Error(`storage_path 소유권 불일치: ${videoId}`);
    }

    const [{ count: transcriptCount }, { count: keyframeCount }] = await Promise.all([
      db.from("transcripts").select("id", { count: "exact", head: true }).eq("video_id", videoId),
      db.from("keyframes").select("id", { count: "exact", head: true }).eq("video_id", videoId),
    ]);

    await setStatus(db, videoId, "transcribing");
    return {
      videoId,
      projectId: video.project_id,
      ownerId: project.owner_id,
      plan: project.plan,
      storagePath: video.storage_path,
      isText: isTextPath(video.storage_path),
      hasTranscript: (transcriptCount ?? 0) > 0,
      hasKeyframes: (keyframeCount ?? 0) > 0,
    };
  },

  async saveTextTranscript(ctx) {
    const db = createAdminClient();
    const raw = await download(db, ctx.storagePath);
    await saveTranscriptRow(db, ctx.videoId, maskDeep(parseTranscriptText(raw.toString("utf-8"))));
  },

  async extractAudio(ctx) {
    const db = createAdminClient();
    await setStage(db, ctx.videoId, "audio");
    const input = await download(db, ctx.storagePath);
    const ext = ctx.storagePath.split(".").pop() ?? "mp4";

    let seconds: number;
    try {
      seconds = await probeDurationSeconds(input, ext);
    } catch {
      throw new UserFacingError("영상 파일을 읽을 수 없습니다. 손상되지 않은 파일인지 확인하고 다시 업로드하세요.");
    }
    // 비용 가드: 클라이언트 신고 길이 대신 ffmpeg 실측 길이로 플랜 한도 판정 (STT 호출 전)
    await db.from("videos").update({ duration_seconds: Math.round(seconds) }).eq("id", ctx.videoId);
    const { plan, usedSeconds } = await getPlanUsage(db, {
      projectId: ctx.projectId,
      ownerId: ctx.ownerId,
      projectPlan: ctx.plan,
      excludeVideoId: ctx.videoId,
    });
    const check = checkUploadAllowed({ plan, usedSeconds, newDurationSeconds: seconds });
    if (!check.allowed) {
      const upgrade =
        ctx.plan === "paid" ? "" : " 프로젝트 화면의 '업그레이드'에서 결제하면 영상 2시간까지 변환할 수 있습니다.";
      throw new UserFacingError(`실제 영상 길이 기준으로 ${check.reason}${upgrade}`);
    }

    // mp3 추출 → 10분 청크 → Storage 임시 저장 (Inngest 단계 간 바이트 전달 불가 — 경로만 넘김)
    const chunks = await splitAudio(await extractAudio(input, ext), CHUNK_DURATION_SECONDS);
    const dir = audioDir(ctx.storagePath);
    const refs: AudioChunk[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const path = `${dir}/chunk_${String(i).padStart(3, "0")}.mp3`;
      // videos 버킷 MIME 화이트리스트에 audio/mpeg가 없어 octet-stream으로 저장
      const { error } = await db.storage
        .from("videos")
        .upload(path, chunks[i].data, { contentType: "application/octet-stream", upsert: true });
      if (error) throw new Error(`오디오 청크 저장 실패: ${error.message}`);
      refs.push({ path, offsetSeconds: chunks[i].offsetSeconds });
    }
    return refs;
  },

  async transcribeChunk(ctx, chunk, index, total) {
    const db = createAdminClient();
    await setStage(db, ctx.videoId, `stt:${index + 1}/${total}`);
    const { data, error } = await db.storage.from("videos").download(chunk.path);
    if (error || !data) throw new Error(`오디오 청크 다운로드 실패: ${chunk.path}`);
    const result = await getSttProvider().transcribe({
      data: new Uint8Array(await data.arrayBuffer()),
      filename: `chunk_${chunk.offsetSeconds}s.mp3`,
    });
    return {
      segments: applyOffset(result.segments, chunk.offsetSeconds),
      language: result.language,
      source: result.source,
    };
  },

  async saveTranscript(ctx, parts) {
    const db = createAdminClient();
    const merged: Transcript = {
      segments: parts.flatMap((p) => p.segments),
      language: parts.at(-1)?.language ?? "ko",
      source: parts.at(-1)?.source ?? "whisper",
    };
    // 마스킹 1차: STT 병합 직후, 저장 전 (주민번호·카드번호만)
    await saveTranscriptRow(db, ctx.videoId, maskDeep(merged));
    await cleanupAudioChunks(ctx.storagePath);
  },

  async extractKeyframes(ctx) {
    const db = createAdminClient();
    await setStage(db, ctx.videoId, "keyframes");
    try {
      const input = await download(db, ctx.storagePath);
      const ext = ctx.storagePath.split(".").pop() ?? "mp4";
      const frames = await extractKeyframes(input, ext);
      for (let i = 0; i < frames.length; i++) {
        const imagePath = `${ctx.storagePath}.keyframes/frame_${String(i).padStart(3, "0")}.jpg`;
        const { error: upErr } = await db.storage
          .from("keyframes")
          .upload(imagePath, frames[i].jpeg, { contentType: "image/jpeg", upsert: true });
        if (upErr) throw new Error(`키프레임 업로드 실패: ${upErr.message}`);
        const { error: kErr } = await db.from("keyframes").insert({
          video_id: ctx.videoId,
          timestamp_seconds: frames[i].timestampSeconds,
          image_path: imagePath,
        });
        if (kErr) throw new Error(`키프레임 저장 실패: ${kErr.message}`);
      }
    } catch (e) {
      console.error(`[pipeline] 키프레임 추출 실패 (무시, ${ctx.videoId}):`, e); // 문서가 본질, 이미지는 보조
    }
  },

  async structure(ctx) {
    const db = createAdminClient();
    await setStatus(db, ctx.videoId, "structuring");
    await setStage(db, ctx.videoId, "structuring");

    const { data: row, error } = await db
      .from("transcripts")
      .select("segments, language")
      .eq("video_id", ctx.videoId)
      .single();
    if (error || !row) throw new Error(`트랜스크립트 조회 실패: ${error?.message}`);
    const transcript: Transcript = {
      segments: row.segments as TranscriptSegment[],
      language: row.language,
      source: "text-file",
    };

    const structured = await structureTranscript(transcriptToPromptText(transcript));
    // 마스킹 2차: 구조화 결과 전체 (LLM이 트랜스크립트 밖 형식으로 재구성한 번호 대비)
    const document = maskDeep(structured.document);

    const { data: doc, error: dErr } = await db
      .from("documents")
      .insert({ project_id: ctx.projectId, content: document, prompt_version: structured.meta.promptVersion })
      .select("id")
      .single();
    if (dErr || !doc) throw new UserFacingError("문서 저장에 실패했습니다. 잠시 후 다시 시도하세요.");

    // 토큰 사용량 DB 기록 (CLAUDE.md 규칙)
    await db.from("ai_usage_logs").insert({
      user_id: ctx.ownerId,
      project_id: ctx.projectId,
      kind: "structure",
      model: structured.meta.model,
      input_tokens: structured.meta.inputTokens,
      output_tokens: structured.meta.outputTokens,
    });
    return { documentId: doc.id };
  },

  async matchKeyframes(ctx, documentId) {
    const db = createAdminClient();
    try {
      const [{ data: frames }, { data: doc }] = await Promise.all([
        db.from("keyframes").select("id, timestamp_seconds").eq("video_id", ctx.videoId),
        db.from("documents").select("content").eq("id", documentId).single(),
      ]);
      if (!frames || frames.length === 0 || !doc) return;
      const document = doc.content as HandoverDocument;
      const matches = matchKeyframesToSteps(
        document.procedures.map((p) => ({ step: p.step, startSeconds: p.sourceTimestamp?.start ?? null })),
        frames.map((f) => ({ id: f.id, timestampSeconds: f.timestamp_seconds }))
      );
      const content = {
        ...document,
        procedures: document.procedures.map((p) => ({ ...p, keyframeId: matches.get(p.step) ?? null })),
      };
      await db.from("documents").update({ content }).eq("id", documentId);
    } catch (e) {
      console.error(`[pipeline] 키프레임 매칭 실패 (무시, ${ctx.videoId}):`, e);
    }
  },

  async enrich(ctx, documentId) {
    const db = createAdminClient();
    await setStage(db, ctx.videoId, "enriching");
    try {
      const { data: doc } = await db.from("documents").select("content").eq("id", documentId).single();
      if (!doc) return;
      const { questions, usage } = await generateEnrichQuestions(JSON.stringify(doc.content));
      await db.from("documents").update({ enrich_questions: questions }).eq("id", documentId);
      await db.from("ai_usage_logs").insert({
        user_id: ctx.ownerId,
        project_id: ctx.projectId,
        kind: "enrich_questions",
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      });
    } catch (e) {
      console.error(`[pipeline] 보강 질문 생성 실패 (무시, ${ctx.videoId}):`, e);
    }
  },

  async finish(ctx) {
    const db = createAdminClient();
    await setStatus(db, ctx.videoId, "done");
    await setStage(db, ctx.videoId, null);
  },
};

// 재시도(Inngest 단계 재실행)에도 안전하도록 upsert
async function saveTranscriptRow(db: Admin, videoId: string, t: Transcript): Promise<void> {
  const { error } = await db
    .from("transcripts")
    .upsert({ video_id: videoId, segments: t.segments, language: t.language }, { onConflict: "video_id" });
  if (error) throw new UserFacingError("트랜스크립트 저장에 실패했습니다. 잠시 후 다시 시도하세요.");
}
