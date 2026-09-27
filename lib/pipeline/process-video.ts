import "server-only";
import { createAdminClient } from "../supabase/admin";
import { parseTranscriptText, transcriptToPromptText } from "../stt/parse-txt";
import { processAudio, probeDurationSeconds } from "../audio/processor";
import { structureTranscript } from "../ai/structure";
import { generateEnrichQuestions } from "../ai/enrich";
import { extractKeyframes } from "../keyframes/extract";
import { matchKeyframesToSteps } from "../keyframes/match";
import { maskDeep } from "../privacy/mask";
import { checkUploadAllowed } from "../plan";
import { getPlanUsage } from "../usage";
import { UserFacingError, toUserMessage } from "../errors";
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
    const { data: project } = await supabase
      .from("projects")
      .select("owner_id, plan")
      .eq("id", video.project_id)
      .single();
    if (!project) throw new Error(`project 없음: ${video.project_id}`);
    // 방어: 경로가 소유자·프로젝트 폴더가 아니면 처리 거부 (타인 파일 처리 방지)
    if (!video.storage_path.startsWith(`${project.owner_id}/${video.project_id}/`)) {
      throw new Error(`storage_path 소유권 불일치: ${videoId}`);
    }

    // 1) STT
    await setStatus("transcribing");
    // 비용 가드: 클라이언트 신고 길이 대신 ffmpeg 실측 길이로 플랜 한도 판정 (STT 호출 전)
    const enforceDuration = async (seconds: number) => {
      await supabase.from("videos").update({ duration_seconds: Math.round(seconds) }).eq("id", videoId);
      const { plan, usedSeconds } = await getPlanUsage(supabase, {
        projectId: video.project_id,
        ownerId: project.owner_id,
        projectPlan: project.plan,
        excludeVideoId: videoId,
      });
      const check = checkUploadAllowed({ plan, usedSeconds, newDurationSeconds: seconds });
      if (!check.allowed) {
        const upgrade =
          project.plan === "paid" ? "" : " 프로젝트 화면의 '업그레이드'에서 결제하면 영상 2시간까지 변환할 수 있습니다.";
        throw new UserFacingError(`실제 영상 길이 기준으로 ${check.reason}${upgrade}`);
      }
    };
    // 마스킹 1차: STT 병합 직후, 저장 전 (주민번호·카드번호만)
    const transcript = maskDeep(await getTranscript(supabase, video.storage_path, enforceDuration));

    const { error: tErr } = await supabase.from("transcripts").insert({
      video_id: videoId,
      segments: transcript.segments,
      language: transcript.language,
    });
    if (tErr) throw new UserFacingError("트랜스크립트 저장에 실패했습니다. 잠시 후 다시 시도하세요.");

    // 2) 구조화 (Phase 0 검증 프롬프트 재사용)
    await setStatus("structuring");
    const structured = await structureTranscript(transcriptToPromptText(transcript));
    // 마스킹 2차: 구조화 결과 전체 (LLM이 트랜스크립트 밖 형식으로 재구성한 번호 대비)
    const result = { ...structured, document: maskDeep(structured.document) };

    const { data: doc, error: dErr } = await supabase
      .from("documents")
      .insert({
        project_id: video.project_id,
        content: result.document,
        prompt_version: result.meta.promptVersion,
      })
      .select("id")
      .single();
    if (dErr || !doc) throw new UserFacingError("문서 저장에 실패했습니다. 잠시 후 다시 시도하세요.");

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
    await supabase.from("ai_usage_logs").insert({
      user_id: project.owner_id,
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
        user_id: project.owner_id,
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
    // 내부 원인은 로그에만, 화면·DB에는 사용자용 문구만 (스택·경로·외부 API 응답 노출 금지)
    console.error(`[pipeline] 처리 실패 (${videoId}):`, e);
    await setStatus("failed", toUserMessage(e));
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
  storagePath: string,
  enforceDuration: (seconds: number) => Promise<void>
): Promise<Transcript> {
  const { data, error } = await supabase.storage.from("videos").download(storagePath);
  if (error || !data) throw new UserFacingError("영상 파일을 불러올 수 없습니다. 다시 업로드하거나 잠시 후 시도하세요.");

  if (storagePath.endsWith(".txt") || storagePath.endsWith(".md")) {
    return parseTranscriptText(await data.text());
  }

  // 영상/오디오: processAudio() 경유 — ffmpeg mp3 추출 + 25MB 초과 시 청크 분할
  // processAudio는 내부에서 getSttProvider()를 호출 (HANDOVER_STT 또는 API 키 자동 선택)
  const ext = storagePath.split(".").pop() ?? "mp4";
  const filename = storagePath.split("/").pop() ?? storagePath;
  const inputData = Buffer.from(await data.arrayBuffer());
  let seconds: number;
  try {
    seconds = await probeDurationSeconds(inputData, ext);
  } catch {
    throw new UserFacingError("영상 파일을 읽을 수 없습니다. 손상되지 않은 파일인지 확인하고 다시 업로드하세요.");
  }
  await enforceDuration(seconds);
  return processAudio(inputData, ext, filename);
}
