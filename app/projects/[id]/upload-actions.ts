"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processVideo } from "@/lib/pipeline/process-video";
import { checkUploadAllowed } from "@/lib/plan";
import { getPlanUsage } from "@/lib/usage";
import { ALLOWED_EXTS, HEADER_BYTES, validateUploadedObject } from "@/lib/upload-validate";
import { checkRateLimit } from "@/lib/rate-limit";

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
    .select("id, project_id, storage_path, status")
    .eq("id", videoId)
    .single();
  if (!video) return { ok: false, error: "영상을 찾을 수 없습니다." };
  if (video.status !== "uploaded") return { ok: false, error: "이미 처리 중인 영상입니다." };

  const admin = createAdminClient();
  const invalid = await verifyUploadedObject(admin, video.storage_path);
  if (invalid) {
    await admin.storage.from("videos").remove([video.storage_path]);
    await admin.from("videos").update({ status: "failed", error_message: invalid }).eq("id", videoId);
    revalidatePath(`/projects/${video.project_id}`);
    return { ok: false, error: invalid };
  }

  const limited = await checkRateLimit(user.id, "pipeline");
  if (limited) {
    await admin.from("videos").update({ status: "failed", error_message: limited }).eq("id", videoId);
    revalidatePath(`/projects/${video.project_id}`);
    return { ok: false, error: limited };
  }

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

  const admin = createAdminClient();
  const limited = await checkRateLimit(user.id, "pipeline");
  if (limited) {
    await admin.from("videos").update({ error_message: limited }).eq("id", videoId);
    revalidatePath(`/projects/${video.project_id}`);
    return;
  }

  await admin
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

// 저장된 객체 재검증: 용량(스토리지 메타데이터) + 선두 바이트 매직 넘버. 문제 있으면 사용자 안내 문구 반환
async function verifyUploadedObject(
  admin: ReturnType<typeof createAdminClient>,
  path: string
): Promise<string | null> {
  const slash = path.lastIndexOf("/");
  const fileName = path.slice(slash + 1);
  const { data: files } = await admin.storage
    .from("videos")
    .list(path.slice(0, slash), { search: fileName });
  const size = files?.find((f) => f.name === fileName)?.metadata?.size as number | undefined;
  if (size === undefined) return "업로드된 파일을 찾을 수 없습니다. 다시 업로드하세요.";

  const { data: signed } = await admin.storage.from("videos").createSignedUrl(path, 60);
  if (!signed) return "업로드된 파일을 확인할 수 없습니다. 잠시 후 다시 업로드하세요.";
  const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } });
  const head = new Uint8Array(await res.arrayBuffer()).slice(0, HEADER_BYTES);

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const result = validateUploadedObject({ ext, sizeBytes: size, head });
  return result.ok ? null : result.reason;
}
