import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "결제 대기",
  confirmed: "결제 완료",
  failed: "실패",
};

const STATUS_COLOR: Record<string, string> = {
  confirmed: "text-[var(--green)]",
  failed: "text-red-400",
  pending: "text-[var(--text-sub)]",
};

export default async function PaymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: payments } = await supabase
    .from("payments")
    .select("id, order_id, amount, status, created_at, confirmed_at, projects(title, id)")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text)]">결제 내역</h1>
        <Link href="/projects" className="text-sm text-[var(--text-sub)] hover:text-[var(--text)]">
          ← 프로젝트 목록
        </Link>
      </div>

      {!payments?.length ? (
        <div className="rounded-lg border border-dashed border-[var(--card-border)] px-4 py-10 text-center text-sm">
          <p className="text-[var(--text-sub)]">결제 내역이 없습니다.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {payments.map((p) => {
            const proj = (Array.isArray(p.projects) ? p.projects[0] : p.projects) as { title: string; id: string } | null;
            const date = new Date(p.confirmed_at ?? p.created_at).toLocaleDateString("ko-KR");
            return (
              <li
                key={p.id}
                className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-5 py-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    {proj ? (
                      <Link
                        href={`/projects/${proj.id}`}
                        className="font-medium text-[var(--text)] hover:underline"
                      >
                        {proj.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-[var(--text-sub)]">삭제된 프로젝트</span>
                    )}
                    <p className="mt-0.5 text-xs text-[var(--text-sub)]">{date}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-[var(--text)]">{p.amount.toLocaleString()}원</p>
                    <p className={`text-xs ${STATUS_COLOR[p.status] ?? "text-[var(--text-sub)]"}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
