"use client";

import Link from "next/link";
import { useEffect } from "react";

// 전역 에러 화면 — 내부 메시지·스택은 노출하지 않고 digest(서버 로그 추적용)만 표시
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) void import("@sentry/nextjs").then((S) => S.captureException(error));
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-lg font-semibold text-[var(--text)]">일시적인 오류가 발생했습니다</h1>
      <p className="mt-2 text-sm text-[var(--text-sub)]">
        다시 시도해도 같은 문제가 반복되면 잠시 후 다시 접속해 주세요.
      </p>
      {error.digest && <p className="mt-2 text-xs text-[var(--text-sub)]">오류 코드: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-80"
        >
          다시 시도
        </button>
        <Link
          href="/"
          className="rounded-md border border-[var(--card-border)] px-4 py-2 text-sm text-[var(--text)] hover:opacity-80"
        >
          홈으로
        </Link>
      </div>
    </main>
  );
}
