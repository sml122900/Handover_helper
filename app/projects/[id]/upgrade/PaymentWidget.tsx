"use client";

import { useState } from "react";
import { loadTossPayments } from "@tosspayments/payment-sdk";

export function PaymentWidget({
  clientKey,
  userId,
  orderId,
  amount,
  successUrl,
  failUrl,
  userEmail,
}: {
  clientKey: string;
  userId: string;
  orderId: string;
  amount: number;
  successUrl: string;
  failUrl: string;
  userEmail: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // userId는 향후 회원 결제 확장용으로 시그니처 유지
  void userId;

  async function handlePay() {
    setError(null);
    setLoading(true);
    try {
      const tossPayments = await loadTossPayments(clientKey);
      await tossPayments.requestPayment("카드", {
        amount,
        orderId,
        orderName: "Handover 프로젝트 업그레이드",
        customerEmail: userEmail,
        successUrl,
        failUrl,
      });
    } catch (e: unknown) {
      setLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("PAY_PROCESS_CANCELED") && !msg.includes("PAYMENT_CANCELED")) {
        setError(`결제 중 오류가 발생했습니다: ${msg}`);
      }
    }
  }

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      <button
        onClick={() => void handlePay()}
        disabled={loading}
        className="w-full rounded-lg bg-[var(--text)] py-3 font-semibold text-[var(--bg)] hover:opacity-80 disabled:opacity-40"
      >
        {loading ? "결제창 여는 중…" : `${amount.toLocaleString()}원 결제하기`}
      </button>
      <p className="mt-3 text-center text-xs text-[var(--text-sub)]">
        토스 · 카드 · 계좌이체 지원
      </p>
    </div>
  );
}
