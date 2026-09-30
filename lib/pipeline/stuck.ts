import { estimatedRemainingSeconds } from "./progress";

// 처리 멈춤 판단 (순수 로직 — vitest 대상)
// uploaded: 이벤트가 처리되면 수 초 안에 바뀌어야 정상 → 5분
// transcribing/structuring: 화면 예상 소요 × 3, 최소 15분 (긴 영상의 정상 처리를 멈춤으로 오판하지 않게)
export const STUCK_UPLOADED_MS = 5 * 60_000;
export const STUCK_PROCESSING_MIN_MS = 15 * 60_000;
export const STUCK_ESTIMATE_FACTOR = 3;

export interface StuckInput {
  status: string;
  stage: string | null;
  durationSeconds: number | null;
  isText: boolean;
  /** status·stage가 마지막으로 바뀐 시각 (ISO). 0011 미적용이면 null → 판단 불가 = 멈춤 아님 */
  statusChangedAt: string | null;
}

export function stuckThresholdMs(input: Omit<StuckInput, "statusChangedAt">): number | null {
  if (input.status === "uploaded") return STUCK_UPLOADED_MS;
  if (input.status === "transcribing" || input.status === "structuring") {
    return Math.max(STUCK_PROCESSING_MIN_MS, estimatedRemainingSeconds(input) * 1000 * STUCK_ESTIMATE_FACTOR);
  }
  return null;
}

/** 기준을 "넘으면"(초과) 멈춤 — 경계값 정확히 같으면 아직 정상 */
export function isStuck(input: StuckInput, now: number = Date.now()): boolean {
  const threshold = stuckThresholdMs(input);
  if (threshold === null || !input.statusChangedAt) return false;
  const changed = Date.parse(input.statusChangedAt);
  if (Number.isNaN(changed)) return false;
  return now - changed > threshold;
}

/** 영상 목록 행(VideoStatusRow)에서 바로 판단 */
export function isRowStuck(
  v: { status: string; stage: string | null; duration_seconds: number | null; storage_path: string; status_changed_at: string | null },
  now: number = Date.now()
): boolean {
  return isStuck(
    {
      status: v.status,
      stage: v.stage,
      durationSeconds: v.duration_seconds,
      isText: v.storage_path.endsWith(".txt") || v.storage_path.endsWith(".md"),
      statusChangedAt: v.status_changed_at,
    },
    now
  );
}
