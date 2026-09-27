import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-lg font-semibold text-[var(--text)]">페이지를 찾을 수 없습니다</h1>
      <p className="mt-2 text-sm text-[var(--text-sub)]">
        주소가 잘못되었거나, 삭제되었거나, 접근 권한이 없는 페이지입니다.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-80"
      >
        홈으로
      </Link>
    </main>
  );
}
