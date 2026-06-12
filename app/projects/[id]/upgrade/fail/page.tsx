import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function UpgradeFailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string; message?: string; orderId?: string }>;
}) {
  const { id: projectId } = await props.params;
  const { code, message } = await props.searchParams;

  const userMessage =
    message ?? (code === "PAY_PROCESS_CANCELED" ? "결제가 취소되었습니다." : "결제 중 오류가 발생했습니다.");

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg font-semibold text-[var(--text)]">결제가 완료되지 않았습니다</p>
      <p className="text-sm text-[var(--text-sub)]">{userMessage}</p>
      {code && code !== "PAY_PROCESS_CANCELED" && (
        <p className="text-xs text-[var(--text-sub)]">오류 코드: {code}</p>
      )}
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
