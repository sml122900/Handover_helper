// 토스페이먼츠 서버 API — 결제 승인 (서버에서만 호출, secretKey 노출 금지)

export type TossConfirmResponse = {
  status: string; // "DONE" | "CANCELED" | "ABORTED" | "EXPIRED" | ...
  paymentKey?: string;
  orderId?: string;
  amount?: number;
  method?: string;
  // 실패 시
  code?: string;
  message?: string;
};

/** 토스페이먼츠 결제 승인 API. 금액·orderId 검증은 호출 전 validateConfirmRequest로 완료해야 함 */
export async function confirmTossPayment(args: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossConfirmResponse> {
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) throw new Error("TOSS_SECRET_KEY가 설정되지 않았습니다.");

  const auth = Buffer.from(`${secretKey}:`).toString("base64");
  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });

  // 토스는 성공/실패 모두 JSON 반환
  return res.json() as Promise<TossConfirmResponse>;
}
