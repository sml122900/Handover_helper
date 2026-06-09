import "server-only";
import { createAdminClient } from "../supabase/admin";
import { parseTranscriptText, transcriptToPromptText } from "../stt/parse-txt";
import { WhisperStt } from "../stt/whisper";
import { structureTranscript } from "../ai/structure";
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

    const { error: dErr } = await supabase.from("documents").insert({
      project_id: video.project_id,
      content: result.document,
      prompt_version: result.meta.promptVersion,
    });
    if (dErr) throw new Error(`문서 저장 실패: ${dErr.message}`);

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

    await setStatus("done");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[pipeline] 처리 실패 (${videoId}):`, message);
    await setStatus("failed", message);
  }
}

async function getTranscript(
  supabase: ReturnType<typeof createAdminClient>,
  storagePath: string
): Promise<Transcript> {
  if (storagePath.endsWith(".txt") || storagePath.endsWith(".md")) {
    const { data, error } = await supabase.storage.from("videos").download(storagePath);
    if (error || !data) throw new Error(`Storage 다운로드 실패: ${error?.message}`);
    return parseTranscriptText(await data.text());
  }
  // TODO: OPENAI_API_KEY 확보 후 Whisper 연동 (현재 mock — 에러로 failed 처리)
  return new WhisperStt().transcribe(storagePath);
}
