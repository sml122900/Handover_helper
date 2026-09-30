import type { SupabaseClient } from "@supabase/supabase-js";
import { runKeyFor } from "./run";

// enqueue 실패는 조용히 넘기지 않음: failed + 사유 저장, onEnqueueError로 Sentry 등에 전달
export const ENQUEUE_FAILED_MESSAGE =
  "변환 작업을 시작하지 못했습니다. '재시도'를 눌러 주세요. 반복되면 파일을 다시 업로드하세요.";

export async function enqueueOrFail(
  db: SupabaseClient,
  videoId: string,
  send: () => Promise<void>,
  onEnqueueError: (e: unknown) => Promise<void> | void
): Promise<void> {
  try {
    await send();
  } catch (e) {
    await db.from("videos").update({ status: "failed", error_message: ENQUEUE_FAILED_MESSAGE }).eq("id", videoId);
    await onEnqueueError(e);
  }
}

// "다시 시도" 선점: failed → uploaded 조건부 update. 동시에 여러 번 눌러도 1건만 통과 → 이벤트 1개
// (순수 로직 — vitest 대상. 트랜스크립트가 있으면 파이프라인이 구조화부터 재실행)
export async function claimAndEnqueueRetry(
  db: SupabaseClient,
  videoId: string,
  enqueue: (runKey: string) => Promise<void>,
  now: () => number = Date.now,
  onEnqueueError: (e: unknown) => Promise<void> | void = () => {}
): Promise<boolean> {
  const { data, error } = await db
    .from("videos")
    .update({ status: "uploaded", error_message: null })
    .eq("id", videoId)
    .eq("status", "failed")
    .select("id");
  if (error || !data || data.length === 0) return false;
  await db.from("videos").update({ stage: null }).eq("id", videoId); // 0009 미적용이면 무시
  await enqueueOrFail(db, videoId, () => enqueue(runKeyFor(videoId, "retry", now())), onEnqueueError);
  return true;
}

// "처리가 멈춘 것 같아요" 재시도: 처리 중 상태 → uploaded 조건부 update
// status + status_changed_at을 조건에 걸어 (화면에서 본 그 상태일 때만) 중복 클릭·정상 진행 경합을 1건으로 차단
export async function claimStuckAndEnqueue(
  db: SupabaseClient,
  videoId: string,
  observed: { status: string; statusChangedAt: string },
  enqueue: (runKey: string) => Promise<void>,
  now: () => number = Date.now,
  onEnqueueError: (e: unknown) => Promise<void> | void = () => {}
): Promise<boolean> {
  const { data, error } = await db
    .from("videos")
    .update({ status: "uploaded", error_message: null })
    .eq("id", videoId)
    .eq("status", observed.status)
    .eq("status_changed_at", observed.statusChangedAt)
    .select("id");
  if (error || !data || data.length === 0) return false;
  await db.from("videos").update({ stage: null }).eq("id", videoId);
  await enqueueOrFail(db, videoId, () => enqueue(runKeyFor(videoId, "retry", now())), onEnqueueError);
  return true;
}
