"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryPipeline, retryStuckPipeline, startPipeline } from "@/lib/pipeline/start";
import { selectVideoStatuses, type VideoStatusRow } from "@/lib/pipeline/video-status";
import { isRowStuck } from "@/lib/pipeline/stuck";
import { checkUploadAllowed } from "@/lib/plan";
import { getPlanUsage } from "@/lib/usage";
import { ALLOWED_EXTS } from "@/lib/upload-validate";

export type PrepareUploadResult =
  | { ok: true; videoId: string; signedUrl: string; token: string; path: string }
  | { ok: false; error: string; upgradeUrl?: string };

// 1단계: 비용 가드 → video 행 생성 → 서명된 업로드 URL 발급
export async function prepareUpload(args: {
  projectId: string;
  fileName: string;
  durationSeconds: number; // .txt는 0
}): Promise<PrepareUploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  // 소유권 확인 (RLS로 본인 프로젝트만 조회됨)
  const { data: project } = await supabase
    .from("projects")
    .select("id, plan")
    .eq("id", args.projectId)
    .single();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const ext = args.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTS.has(ext)) {
    return { ok: false, error: "지원 형식: mp4, mov, webm, m4a (영상/오디오) 또는 txt (트랜스크립트)" };
  }

  // 비용 가드 1차 (UI 안내용 — 클라이언트 신고 길이). 최종 판정은 파이프라인의 ffmpeg 실측 길이
  // paid: 프로젝트 단위 2시간, free: 계정 전체 20분
  const admin = createAdminClient();
  const { plan, usedSeconds } = await getPlanUsage(admin, {
    projectId: args.projectId,
    ownerId: user.id,
    projectPlan: project.plan,
  });
  const check = checkUploadAllowed({ plan, usedSeconds, newDurationSeconds: args.durationSeconds });
  if (!check.allowed) {
    return {
      ok: false,
      error: check.reason,
      ...(project.plan !== "paid" && { upgradeUrl: `/projects/${args.projectId}/upgrade` }),
    };
  }

  const path = `${user.id}/${args.projectId}/${crypto.randomUUID()}.${ext}`;

  // videos 쓰기는 service_role만 (0008 — 사용자 직접 insert/update 시 경로·상태 조작 위험)
  const { data: video, error: vErr } = await admin
    .from("videos")
    .insert({
      project_id: args.projectId,
      storage_path: path,
      duration_seconds: ext === "txt" ? null : Math.round(args.durationSeconds),
      status: "uploaded",
    })
    .select("id")
    .single();
  if (vErr || !video) return { ok: false, error: "업로드 준비에 실패했습니다." };

  const { data: signed, error: sErr } = await admin.storage
    .from("videos")
    .createSignedUploadUrl(path);
  if (sErr || !signed) {
    await admin.from("videos").delete().eq("id", video.id);
    return { ok: false, error: "업로드 URL 발급에 실패했습니다. 잠시 후 다시 시도하세요." };
  }

  return { ok: true, videoId: video.id, signedUrl: signed.signedUrl, token: signed.token, path };
}

// 2단계: 업로드 완료 → 서버 재검증(매직 넘버·용량)·레이트리밋 → 큐 등록 (Inngest 기본, HANDOVER_QUEUE=inline이면 after 훅)
export async function completeUpload(videoId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const result = await startPipeline(supabase, user.id, videoId);
  if (result.projectId) revalidatePath(`/projects/${result.projectId}`);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// 실패한 영상 재시도: 트랜스크립트가 이미 있으면 구조화부터 (STT 재과금 없음). 중복 클릭은 조건부 update로 1건만
export async function retryVideo(formData: FormData): Promise<void> {
  const videoId = formData.get("videoId") as string;
  if (!videoId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const result = await retryPipeline(supabase, user.id, videoId);
  if (result.projectId) revalidatePath(`/projects/${result.projectId}`);
}

// 폴링용: 프로젝트 영상 상태 조회 (stage는 0009 이후 — 컬럼이 없으면 status만)
export async function getVideoStatuses(projectId: string): Promise<(VideoStatusRow & { stuck: boolean })[]> {
  const supabase = await createClient();
  const rows = await selectVideoStatuses(supabase, projectId);
  return rows.map((v) => ({ ...v, stuck: isRowStuck(v) })); // 서버 시계로 판단 (클라이언트 시계 차이 방지)
}

// 멈춘 영상 재시도: 서버가 멈춤을 다시 판단, 트랜스크립트가 있으면 구조화부터 (STT 재과금 없음)
export async function retryStuckVideo(formData: FormData): Promise<void> {
  const videoId = formData.get("videoId") as string;
  if (!videoId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const result = await retryStuckPipeline(supabase, user.id, videoId);
  if (result.projectId) revalidatePath(`/projects/${result.projectId}`);
}
