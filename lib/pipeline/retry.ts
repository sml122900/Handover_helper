import type { SupabaseClient } from "@supabase/supabase-js";
import { runKeyFor } from "./run";

// "다시 시도" 선점: failed → uploaded 조건부 update. 동시에 여러 번 눌러도 1건만 통과 → 이벤트 1개
// (순수 로직 — vitest 대상. 트랜스크립트가 있으면 파이프라인이 구조화부터 재실행)
export async function claimAndEnqueueRetry(
  db: SupabaseClient,
  videoId: string,
  enqueue: (runKey: string) => Promise<void>,
  now: () => number = Date.now
): Promise<boolean> {
  const { data, error } = await db
    .from("videos")
    .update({ status: "uploaded", error_message: null })
    .eq("id", videoId)
    .eq("status", "failed")
    .select("id");
  if (error || !data || data.length === 0) return false;
  await db.from("videos").update({ stage: null }).eq("id", videoId); // 0009 미적용이면 무시
  await enqueue(runKeyFor(videoId, "retry", now()));
  return true;
}
