"use client";

import { useEffect, useRef, useState } from "react";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";

type Widgets = Awaited<ReturnType<Awaited<ReturnType<typeof loadTossPayments>>["widgets"]>>;

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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const widgetsRef = useRef<Widgets | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const tossPayments = await loadTossPayments(clientKey);
        const widgets = tossPayments.widgets({ customerKey: userId });

        await widgets.setAmount({ currency: "KRW", value: amount });
        await Promise.all([
          widgets.renderPaymentMethods({ selector: "#toss-payment-method", variantKey: "DEFAULT" }),
          widgets.renderAgreement({ selector: "#toss-agreement", variantKey: "AGREEMENT" }),
        ]);

        if (!mounted) return;
        widgetsRef.current = widgets;
        setReady(true);
      } catch {
        if (mounted) setError("결제 위젯 로딩에 실패했습니다. 페이지를 새로고침하세요.");
      }
    }

    void init();
    return () => {
      mounted = false;
    };
  }, [clientKey, userId, amount]);

  async function handlePay() {
    if (!widgetsRef.current) return;
    setError(null);
    try {
      await widgetsRef.current.requestPayment({
        orderId,
        orderName: "Handover 프로젝트 업그레이드",
        successUrl,
        failUrl,
        customerEmail: userEmail,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("PAY_PROCESS_CANCELED") && !msg.includes("PAYMENT_CANCELED")) {
        setError("결제 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.");
      }
    }
  }

  return (
    <div>
      <div id="toss-payment-method" className="min-h-[200px]" />
      <div id="toss-agreement" />

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <button
        onClick={() => void handlePay()}
        disabled={!ready}
        className="mt-6 w-full rounded-lg bg-[var(--text)] py-3 font-semibold text-[var(--bg)] hover:opacity-80 disabled:opacity-40"
      >
        {ready ? `${amount.toLocaleString()}원 결제하기` : "결제 위젯 불러오는 중…"}
      </button>
    </div>
  );
}
