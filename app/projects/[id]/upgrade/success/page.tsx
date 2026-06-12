import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateConfirmRequest, type PaymentStatus } from "@/lib/payments/confirm-logic";
import { confirmTossPayment } from "@/lib/payments/toss";

export const dynamic = "force-dynamic";

export default async function UpgradeSuccessPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }>;
}) {
  const { id: projectId } = await props.params;
  const { paymentKey, orderId, amount: amountStr } = await props.searchParams;

  if (!paymentKey || !orderId || !amountStr) {
    return <ErrorView message="필수 결제 정보가 누락되었습니다." projectId={projectId} />;
  }

  const queryAmount = parseInt(amountStr, 10);
  if (isNaN(queryAmount)) {
    return <ErrorView message="금액 형식이 올바르지 않습니다." projectId={projectId} />;
  }

  const admin = createAdminClient();

  const { data: payment } = await admin
    .from("payments")
    .select("id, amount, status, project_id")
    .eq("order_id", orderId)
    .single();

  if (!payment || payment.project_id !== projectId) {
    return <ErrorView message="유효하지 않은 주문입니다." projectId={projectId} />;
  }

  // 이미 승인됨 → 멱등성 처리
  if (payment.status === "confirmed") {
    redirect(`/projects/${projectId}?upgraded=1`);
  }

  // 금액·상태 서버 검증
  const validation = validateConfirmRequest({
    queryAmount,
    dbAmount: payment.amount,
    dbStatus: payment.status as PaymentStatus,
  });
  if (!validation.ok) {
    return <ErrorView message={validation.error} projectId={projectId} />;
  }

  // 토스 서버 승인 API 호출
  let tossResult;
  try {
    tossResult = await confirmTossPayment({ paymentKey, orderId, amount: queryAmount });
  } catch {
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    return <ErrorView message="결제 승인 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." projectId={projectId} />;
  }

  if (tossResult.status !== "DONE") {
    await admin
      .from("payments")
      .update({ status: "failed", toss_response: tossResult })
      .eq("id", payment.id);
    return (
      <ErrorView
        message={`결제 승인 실패: ${tossResult.message ?? tossResult.code ?? "알 수 없는 오류"}`}
        projectId={projectId}
      />
    );
  }

  // 승인 성공 → payments 업데이트 + project plan=paid 전환
  await Promise.all([
    admin.from("payments").update({
      status: "confirmed",
      payment_key: paymentKey,
      toss_response: tossResult,
      confirmed_at: new Date().toISOString(),
    }).eq("id", payment.id),
    admin.from("projects").update({ plan: "paid" }).eq("id", projectId),
  ]);

  redirect(`/projects/${projectId}?upgraded=1`);
}

function ErrorView({ message, projectId }: { message: string; projectId: string }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg font-semibold text-[var(--text)]">결제를 완료하지 못했습니다</p>
      <p className="text-sm text-red-400">{message}</p>
      <Link
        href={`/projects/${projectId}/upgrade`}
        className="rounded-md bg-[var(--text)] px-5 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-80"
      >
        다시 시도하기
      </Link>
      <Link href={`/projects/${projectId}`} className="text-xs text-[var(--text-sub)] underline hover:text-[var(--text)]">
        프로젝트로 돌아가기
      </Link>
    </main>
  );
}
