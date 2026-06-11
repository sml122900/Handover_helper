import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold text-[var(--text)]">Handover</h1>
      <p className="text-lg text-[var(--text)]">
        퇴사 전 30분 녹화로, 한 달치 인수인계를 끝내세요.
      </p>
      <p className="text-sm text-[var(--text-sub)]">
        인수인계 영상을 업로드하면 후임자가 바로 일할 수 있는 문서로 변환합니다.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-lg bg-[var(--text)] px-6 py-3 font-medium text-[var(--bg)] hover:opacity-80"
        >
          시작하기
        </Link>
        <Link
          href="/projects"
          className="rounded-lg border border-[var(--card-border)] px-6 py-3 font-medium text-[var(--text)] hover:border-[var(--card-border-hover)]"
        >
          내 프로젝트
        </Link>
      </div>
    </main>
  );
}
