import "server-only";
import { createAdminClient } from "../supabase/admin";
import { parseTranscriptText, transcriptToPromptText } from "../stt/parse-txt";
import { processAudio } from "../audio/processor";
import { structureTranscript } from "../ai/structure";
import { generateEnrichQuestions } from "../ai/enrich";
import { extractKeyframes } from "../keyframes/extract";
import { matchKeyframesToSteps } from "../keyframes/match";
import type { HandoverDocument } from "../ai/schema";
import type { Transcript } from "../stt/types";

// 비동기 변환 파이프라인: uploaded → transcribing → structuring → done/failed
// 현재 구동: server action의 after() 훅 (요청 응답 후 실행).
// TODO(스케일): Vercel 함수 타임아웃 한계 → Inngest 또는 Supabase Edge Functions 큐로 이전

export async function processVideo(videoId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: video, error } = await supabase
    .from("videos")
    .select("id, project_id, storage_path, status")
    .eq("id", videoId)
    .single();
  if (error || !video) {
    console.error(`[pipeline] video 조회 실패: ${videoId}`, error);
    return;
  }
  if (video.status !== "uploaded") {
    console.warn(`[pipeline] 이미 처리됨/처리 중 (status=${video.status}): ${videoId}`);
    return;
  }

  const setStatus = async (status: string, errorMessage?: string) => {
    await supabase
      .from("videos")
      .update({ status, error_message: errorMessage ?? null })
      .eq("id", videoId);
  };

  try {
    // 1) STT
    await setStatus("transcribing");
    const transcript = await getTranscript(supabase, video.storage_path);

    const { error: tErr } = await supabase.from("transcripts").insert({
      video_id: videoId,
      segments: transcript.segments,
      language: transcript.language,
    });
    if (tErr) throw new Error(`트랜스크립트 저장 실패: ${tErr.message}`);

    // 2) 구조화 (Phase 0 검증 프롬프트 재사용)
    await setStatus("structuring");
    const result = await structureTranscript(transcriptToPromptText(transcript));

    const { data: doc, error: dErr } = await supabase
      .from("documents")
      .insert({
        project_id: video.project_id,
        content: result.document,
        prompt_version: result.meta.promptVersion,
      })
      .select("id")
      .single();
    if (dErr || !doc) throw new Error(`문서 저장 실패: ${dErr?.message}`);

    // 2.5) 키프레임 추출 + 절차 매칭 (영상 파일만, 실패해도 문서는 유지)
    if (!video.storage_path.endsWith(".txt") && !video.storage_path.endsWith(".md")) {
      try {
        await extractAndMatchKeyframes(supabase, {
          videoId,
          storagePath: video.storage_path,
          documentId: doc.id,
          document: result.document,
        });
      } catch (e) {
        console.error(`[pipeline] 키프레임 추출 실패 (무시, ${videoId}):`, e);
      }
    }

    // 3) 토큰 사용량 DB 기록 (CLAUDE.md 규칙)
    const { data: project } = await supabase
      .from("projects")
      .select("owner_id")
      .eq("id", video.project_id)
      .single();
    await supabase.from("ai_usage_logs").insert({
      user_id: project?.owner_id ?? null,
      project_id: video.project_id,
      kind: "structure",
      model: result.meta.model,
      input_tokens: result.meta.inputTokens,
      output_tokens: result.meta.outputTokens,
    });

    // 4) 보강 질문 생성 (빈/불확실 섹션 대상 3~5개, 실패해도 문서는 유지)
    try {
      const { questions, usage } = await generateEnrichQuestions(
        JSON.stringify(result.document)
      );
      await supabase.from("documents").update({ enrich_questions: questions }).eq("id", doc.id);
      await supabase.from("ai_usage_logs").insert({
        user_id: project?.owner_id ?? null,
        project_id: video.project_id,
        kind: "enrich_questions",
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      });
    } catch (e) {
      console.error(`[pipeline] 보강 질문 생성 실패 (무시, ${videoId}):`, e);
    }

    await setStatus("done");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[pipeline] 처리 실패 (${videoId}):`, message);
    await setStatus("failed", message);
  }
}

// 키프레임: ffmpeg 장면 전환 → keyframes 버킷 업로드 → DB 행 → 절차 단계 매칭 → 문서 content에 keyframeId 기록
async function extractAndMatchKeyframes(
  supabase: ReturnType<typeof createAdminClient>,
  args: {
    videoId: string;
    storagePath: string;
    documentId: string;
    document: HandoverDocument;
  }
): Promise<void> {
  const { data: file, error } = await supabase.storage.from("videos").download(args.storagePath);
  if (error || !file) throw new Error(`영상 다운로드 실패: ${error?.message}`);

  const ext = args.storagePath.split(".").pop() ?? "mp4";
  const frames = await extractKeyframes(Buffer.from(await file.arrayBuffer()), ext);
  if (frames.length === 0) return;

  const keyframeRefs: { id: string; timestampSeconds: number }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const imagePath = `${args.storagePath}.keyframes/frame_${String(i).padStart(3, "0")}.jpg`;
    const { error: upErr } = await supabase.storage
      .from("keyframes")
      .upload(imagePath, frames[i].jpeg, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`키프레임 업로드 실패: ${upErr.message}`);

    const { data: row, error: kErr } = await supabase
      .from("keyframes")
      .insert({
        video_id: args.videoId,
        timestamp_seconds: frames[i].timestampSeconds,
        image_path: imagePath,
      })
      .select("id")
      .single();
    if (kErr || !row) throw new Error(`키프레임 저장 실패: ${kErr?.message}`);
    keyframeRefs.push({ id: row.id, timestampSeconds: frames[i].timestampSeconds });
  }

  const matches = matchKeyframesToSteps(
    args.document.procedures.map((p) => ({
      step: p.step,
      startSeconds: p.sourceTimestamp?.start ?? null,
    })),
    keyframeRefs
  );

  const content = {
    ...args.document,
    procedures: args.document.procedures.map((p) => ({
      ...p,
      keyframeId: matches.get(p.step) ?? null,
    })),
  };
  await supabase.from("documents").update({ content }).eq("id", args.documentId);
}

async function getTranscript(
  supabase: ReturnType<typeof createAdminClient>,
  storagePath: string
): Promise<Transcript> {
  const { data, error } = await supabase.storage.from("videos").download(storagePath);
  if (error || !data) throw new Error(`Storage 다운로드 실패: ${error?.message}`);

  if (storagePath.endsWith(".txt") || storagePath.endsWith(".md")) {
    return parseTranscriptText(await data.text());
  }

  // 영상/오디오: processAudio() 경유 — ffmpeg mp3 추출 + 25MB 초과 시 청크 분할
  // processAudio는 내부에서 getSttProvider()를 호출 (HANDOVER_STT 또는 API 키 자동 선택)
  const ext = storagePath.split(".").pop() ?? "mp4";
  const filename = storagePath.split("/").pop() ?? storagePath;
  const inputData = Buffer.from(await data.arrayBuffer());
  return processAudio(inputData, ext, filename);
}
