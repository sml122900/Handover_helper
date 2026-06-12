"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processVideo } from "@/lib/pipeline/process-video";
import { checkUploadAllowed, FREE_PLAN, PAID_PLAN } from "@/lib/plan";

const ALLOWED_EXTS = new Set(["mp4", "webm", "m4a", "mov", "txt"]);

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

  // 비용 가드 — paid: 프로젝트 단위 2시간, free: 계정 전체 20분
  const admin = createAdminClient();
  let usedSeconds: number;
  if (project.plan === "paid") {
    const { data: projVideos } = await admin
      .from("videos")
      .select("duration_seconds, status")
      .eq("project_id", args.projectId);
    usedSeconds = (projVideos ?? [])
      .filter((v) => v.status !== "failed")
      .reduce((sum, v) => sum + (v.duration_seconds ?? 0), 0);
  } else {
    const { data: myProjects } = await admin.from("projects").select("id").eq("owner_id", user.id);
    const projectIds = (myProjects ?? []).map((p) => p.id);
    const { data: myVideos } = await admin
      .from("videos")
      .select("duration_seconds, status")
      .in("project_id", projectIds.length > 0 ? projectIds : ["00000000-0000-0000-0000-000000000000"]);
    usedSeconds = (myVideos ?? [])
      .filter((v) => v.status !== "failed")
      .reduce((sum, v) => sum + (v.duration_seconds ?? 0), 0);
  }

  const plan = project.plan === "paid" ? PAID_PLAN : FREE_PLAN;
  const check = checkUploadAllowed({ plan, usedSeconds, newDurationSeconds: args.durationSeconds });
  if (!check.allowed) {
    return {
      ok: false,
      error: check.reason,
      ...(project.plan !== "paid" && { upgradeUrl: `/projects/${args.projectId}/upgrade` }),
    };
  }

  const path = `${user.id}/${args.projectId}/${crypto.randomUUID()}.${ext}`;

  const { data: video, error: vErr } = await supabase
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

// 2단계: 업로드 완료 → 응답 후 백그라운드 파이프라인 시작
export async function completeUpload(videoId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  // RLS로 본인 영상만 조회 가능 — 소유권 검증
  const { data: video } = await supabase
    .from("videos")
    .select("id, project_id")
    .eq("id", videoId)
    .single();
  if (!video) return { ok: false, error: "영상을 찾을 수 없습니다." };

  after(() => processVideo(videoId));
  revalidatePath(`/projects/${video.project_id}`);
  return { ok: true };
}

// 실패한 영상 재시도: 상태 초기화 → 파이프라인 재실행
export async function retryVideo(formData: FormData): Promise<void> {
  const videoId = formData.get("videoId") as string;
  if (!videoId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // RLS: 본인 영상만 조회됨 — 소유권 자동 검증, failed 상태만 재시도 허용
  const { data: video } = await supabase
    .from("videos")
    .select("id, project_id")
    .eq("id", videoId)
    .eq("status", "failed")
    .single();
  if (!video) return;

  await supabase
    .from("videos")
    .update({ status: "uploaded", error_message: null })
    .eq("id", videoId);

  after(() => processVideo(videoId));
  revalidatePath(`/projects/${video.project_id}`);
}

// 폴링용: 프로젝트 영상 상태 조회
export async function getVideoStatuses(
  projectId: string
): Promise<Array<{ id: string; status: string; error_message: string | null }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("videos")
    .select("id, status, error_message")
    .eq("project_id", projectId);
  return data ?? [];
}
