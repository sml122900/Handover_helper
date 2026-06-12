// 결제 승인 전 서버 측 검증 — 순수 함수 (vitest 단위 테스트 대상)

export type PaymentStatus = "pending" | "confirmed" | "failed";

export type ConfirmValidation = { ok: true } | { ok: false; error: string };

/** 토스 confirm API 호출 전 금액·상태 검증. 클라이언트 값을 신뢰하지 않음 */
export function validateConfirmRequest(args: {
  queryAmount: number; // 토스가 successUrl query로 넘긴 금액
  dbAmount: number;    // DB에 저장된 주문 금액
  dbStatus: PaymentStatus;
}): ConfirmValidation {
  const { queryAmount, dbAmount, dbStatus } = args;

  if (dbStatus === "confirmed") {
    return { ok: false, error: "이미 승인된 주문입니다." };
  }
  if (dbStatus === "failed") {
    return { ok: false, error: "실패 처리된 주문입니다. 새로 결제를 시도하세요." };
  }
  if (!Number.isInteger(queryAmount) || queryAmount <= 0) {
    return { ok: false, error: "금액 형식이 올바르지 않습니다." };
  }
  if (queryAmount !== dbAmount) {
    return {
      ok: false,
      error: `금액 불일치: 요청 ${queryAmount.toLocaleString()}원 ≠ 주문 ${dbAmount.toLocaleString()}원.`,
    };
  }
  return { ok: true };
}
