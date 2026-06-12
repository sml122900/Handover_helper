import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PaymentWidget } from "./PaymentWidget";

export const dynamic = "force-dynamic";

const UPGRADE_AMOUNT = 9900;

export default async function UpgradePage(props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, plan")
    .eq("id", projectId)
    .single();
  if (!project) notFound();

  // 이미 유료 프로젝트면 프로젝트 페이지로
  if (project.plan === "paid") redirect(`/projects/${projectId}`);

  const admin = createAdminClient();

  // 기존 pending 주문 재사용 (중복 생성 방지)
  let orderId: string;
  const { data: existing } = await admin
    .from("payments")
    .select("order_id")
    .eq("project_id", projectId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    orderId = existing.order_id;
  } else {
    orderId = `handover-${crypto.randomUUID()}`;
    await admin.from("payments").insert({
      order_id: orderId,
      user_id: user.id,
      project_id: projectId,
      amount: UPGRADE_AMOUNT,
      status: "pending",
    });
  }

  // successUrl/failUrl — 헤더에서 host 추출 (dev/prod 모두 동작)
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3010";
  const baseUrl = `${proto}://${host}`;
  const successUrl = `${baseUrl}/projects/${projectId}/upgrade/success`;
  const failUrl = `${baseUrl}/projects/${projectId}/upgrade/fail`;

  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <Link
        href={`/projects/${projectId}`}
        className="text-sm text-[var(--text-sub)] hover:text-[var(--text)]"
      >
        ← 돌아가기
      </Link>

      <h1 className="mt-4 mb-2 text-2xl font-bold text-[var(--text)]">프로젝트 업그레이드</h1>
      <p className="mb-6 text-sm text-[var(--text-sub)]">
        <strong className="text-[var(--text)]">{project.title}</strong>
      </p>

      <div className="mb-6 rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-[var(--text)]">프로젝트 PRO</p>
            <p className="mt-1 text-xs text-[var(--text-sub)]">이 프로젝트에 영상 총 2시간 업로드</p>
          </div>
          <p className="text-xl font-bold text-[var(--text)]">9,900원</p>
        </div>
        <ul className="mt-4 flex flex-col gap-1 text-xs text-[var(--text-sub)]">
          <li className="flex gap-2"><span className="text-[var(--green)]">✓</span> 이 프로젝트에만 적용 (건당 결제)</li>
          <li className="flex gap-2"><span className="text-[var(--green)]">✓</span> 영상 총 2시간 처리 (현재 Free 20분)</li>
          <li className="flex gap-2"><span className="text-[var(--green)]">✓</span> 생성된 문서는 영구 보존</li>
        </ul>
      </div>

      {clientKey ? (
        <PaymentWidget
          clientKey={clientKey}
          userId={user.id}
          orderId={orderId}
          amount={UPGRADE_AMOUNT}
          successUrl={successUrl}
          failUrl={failUrl}
          userEmail={user.email ?? ""}
        />
      ) : (
        <p className="text-sm text-red-400">
          결제 설정이 완료되지 않았습니다. (NEXT_PUBLIC_TOSS_CLIENT_KEY 미설정)
        </p>
      )}
    </main>
  );
}
