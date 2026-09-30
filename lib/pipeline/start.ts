import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { HEADER_BYTES, validateUploadedObject } from "../upload-validate";
import { checkRateLimit } from "../rate-limit";
import { inngest, VIDEO_UPLOADED, type VideoUploadedData } from "../inngest/client";
import { captureError } from "../observability";
import { processVideo } from "./process-video";
import { runKeyFor } from "./run";
import { claimAndEnqueueRetry, claimStuckAndEnqueue } from "./retry";
import { isStuck } from "./stuck";

// 파이프라인 시작·재시도 — 서버 액션(completeUpload·retryVideo)과 /api/pipeline/start 공용
// supabase는 호출자 세션 클라이언트 (RLS로 본인 영상만 조회 = 소유권 검사)

export type QueueMode = "inngest" | "inline";

export function queueMode(env: Record<string, string | undefined> = process.env): QueueMode {
  return env.HANDOVER_QUEUE === "inline" ? "inline" : "inngest";
}

async function enqueue(data: VideoUploadedData): Promise<void> {
  if (queueMode() === "inline") {
    after(() => processVideo(data.videoId)); // 요청 응답 후 같은 인스턴스에서 실행 (로컬·mock용)
    return;
  }
  await inngest.send({ name: VIDEO_UPLOADED, data });
}

export type StartResult = { ok: true; projectId: string } | { ok: false; error: string; projectId?: string };

export async function startPipeline(
  supabase: SupabaseClient,
  userId: string,
  videoId: string
): Promise<StartResult> {
  const { data: video } = await supabase
    .from("videos")
    .select("id, project_id, storage_path, status")
    .eq("id", videoId)
    .single();
  if (!video) return { ok: false, error: "영상을 찾을 수 없습니다." };
  if (video.status !== "uploaded") {
    return { ok: false, error: "이미 처리 중인 영상입니다.", projectId: video.project_id };
  }

  const admin = createAdminClient();
  const fail = async (error: string) => {
    await admin.from("videos").update({ status: "failed", error_message: error }).eq("id", videoId);
    return { ok: false as const, error, projectId: video.project_id };
  };

  const invalid = await verifyUploadedObject(admin, video.storage_path);
  if (invalid) {
    await admin.storage.from("videos").remove([video.storage_path]);
    return fail(invalid);
  }

  const limited = await checkRateLimit(userId, "pipeline");
  if (limited) return fail(limited);

  try {
    await enqueue({ videoId, userId, runKey: runKeyFor(videoId, "initial") });
  } catch (e) {
    await captureError(e, { videoId, stage: "enqueue" });
    return fail("변환 작업을 시작하지 못했습니다. '다시 시도'를 눌러 주세요.");
  }
  return { ok: true, projectId: video.project_id };
}

export async function retryPipeline(
  supabase: SupabaseClient,
  userId: string,
  videoId: string
): Promise<StartResult> {
  // RLS: 본인 영상만 조회됨 — 소유권 자동 검증, failed 상태만 재시도 허용
  const { data: video } = await supabase
    .from("videos")
    .select("id, project_id")
    .eq("id", videoId)
    .eq("status", "failed")
    .single();
  if (!video) return { ok: false, error: "재시도할 수 있는 영상이 아닙니다." };

  const admin = createAdminClient();
  const limited = await checkRateLimit(userId, "pipeline");
  if (limited) {
    await admin.from("videos").update({ error_message: limited }).eq("id", videoId);
    return { ok: false, error: limited, projectId: video.project_id };
  }

  const claimed = await claimAndEnqueueRetry(admin, videoId, (runKey) => enqueue({ videoId, userId, runKey }), Date.now, (e) =>
    captureError(e, { videoId, stage: "enqueue-retry" })
  );
  return claimed
    ? { ok: true, projectId: video.project_id }
    : { ok: false, error: "이미 재시도 중입니다.", projectId: video.project_id };
}

// 저장된 객체 재검증: 용량(스토리지 메타데이터) + 선두 바이트 매직 넘버. 문제 있으면 사용자 안내 문구 반환
async function verifyUploadedObject(admin: SupabaseClient, path: string): Promise<string | null> {
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

// 멈춘 영상 재시도 — 서버 시계로 멈춤을 다시 판단(클라이언트 신뢰 안 함), 화면과 같은 status·status_changed_at일 때만 선점
export async function retryStuckPipeline(
  supabase: SupabaseClient,
  userId: string,
  videoId: string
): Promise<StartResult> {
  const { data: video } = await supabase
    .from("videos")
    .select("id, project_id, status, stage, duration_seconds, storage_path, status_changed_at")
    .eq("id", videoId)
    .single();
  if (!video) return { ok: false, error: "영상을 찾을 수 없습니다." };
  const stuck = isStuck({
    status: video.status,
    stage: video.stage,
    durationSeconds: video.duration_seconds,
    isText: video.storage_path.endsWith(".txt") || video.storage_path.endsWith(".md"),
    statusChangedAt: video.status_changed_at,
  });
  if (!stuck) return { ok: false, error: "아직 처리 중인 영상입니다. 잠시 후 다시 확인하세요.", projectId: video.project_id };

  const admin = createAdminClient();
  const limited = await checkRateLimit(userId, "pipeline");
  if (limited) return { ok: false, error: limited, projectId: video.project_id };

  const claimed = await claimStuckAndEnqueue(
    admin,
    videoId,
    { status: video.status, statusChangedAt: video.status_changed_at },
    (runKey) => enqueue({ videoId, userId, runKey }),
    Date.now,
    (e) => captureError(e, { videoId, stage: "enqueue-stuck-retry" })
  );
  return claimed
    ? { ok: true, projectId: video.project_id }
    : { ok: false, error: "이미 재시도했거나 상태가 바뀐 영상입니다.", projectId: video.project_id };
}
