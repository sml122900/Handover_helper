// 키프레임 ↔ 업무 절차 단계 매칭 (순수 로직 — vitest 테스트 대상)

export interface KeyframeRef {
  id: string;
  timestampSeconds: number;
}

export interface StepRef {
  step: number;
  /** 절차 단계의 sourceTimestamp.start (초). 없으면 null */
  startSeconds: number | null;
}

/** 단계 시작 시점에서 이 범위(초) 안의 키프레임만 매칭 후보로 인정 */
export const MATCH_WINDOW_SECONDS = 90;

// 각 단계에 가장 가까운 키프레임 id를 매칭. 범위 밖이거나 타임스탬프 없으면 null.
export function matchKeyframesToSteps(
  steps: StepRef[],
  keyframes: KeyframeRef[]
): Map<number, string | null> {
  const result = new Map<number, string | null>();
  for (const s of steps) {
    if (s.startSeconds === null || keyframes.length === 0) {
      result.set(s.step, null);
      continue;
    }
    let best: KeyframeRef | null = null;
    let bestDist = Infinity;
    for (const k of keyframes) {
      const dist = Math.abs(k.timestampSeconds - s.startSeconds);
      if (dist < bestDist) {
        best = k;
        bestDist = dist;
      }
    }
    result.set(s.step, best !== null && bestDist <= MATCH_WINDOW_SECONDS ? best.id : null);
  }
  return result;
}
