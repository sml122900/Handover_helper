// 플랜·비용 가드 (순수 로직 — vitest 단위 테스트 대상)
// 가격 정책(Phase 2): Free 총 20분 / 건당 9,900원 = 프로젝트 1개·영상 2시간

export interface Plan {
  name: string;
  /** 계정 전체 누적 영상 분 한도 */
  totalMinutes: number;
  /** 영상 1개 최대 분 */
  maxVideoMinutes: number;
}

export const FREE_PLAN: Plan = { name: "free", totalMinutes: 20, maxVideoMinutes: 20 };
export const PAID_PLAN: Plan = { name: "paid", totalMinutes: 120, maxVideoMinutes: 120 };

export type UploadCheck = { allowed: true } | { allowed: false; reason: string };

export function checkUploadAllowed(args: {
  plan: Plan;
  /** 기존 영상 누적 길이 (초, 실패 제외) */
  usedSeconds: number;
  /** 새 영상 길이 (초). 트랜스크립트(.txt) 업로드는 0 */
  newDurationSeconds: number;
}): UploadCheck {
  const { plan, usedSeconds, newDurationSeconds } = args;

  if (!Number.isFinite(newDurationSeconds) || newDurationSeconds < 0) {
    return { allowed: false, reason: "영상 길이를 확인할 수 없습니다. 파일이 손상되지 않았는지 확인하세요." };
  }
  if (newDurationSeconds > plan.maxVideoMinutes * 60) {
    return {
      allowed: false,
      reason: `영상 1개 한도(${plan.maxVideoMinutes}분)를 초과합니다. 영상을 나눠서 업로드하세요.`,
    };
  }
  if (usedSeconds + newDurationSeconds > plan.totalMinutes * 60) {
    const remaining = Math.max(0, Math.floor((plan.totalMinutes * 60 - usedSeconds) / 60));
    return {
      allowed: false,
      reason: `플랜 한도(총 ${plan.totalMinutes}분)를 초과합니다. 남은 분량: 약 ${remaining}분. 결제 후 이용하세요.`,
    };
  }
  return { allowed: true };
}
