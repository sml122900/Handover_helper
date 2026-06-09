import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold text-white">Handover</h1>
      <p className="text-lg text-zinc-300">
        퇴사 전 30분 녹화로, 한 달치 인수인계를 끝내세요.
      </p>
      <p className="text-sm text-zinc-500">
        인수인계 영상을 업로드하면 후임자가 바로 일할 수 있는 문서로 변환합니다.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-lg bg-white px-6 py-3 font-medium text-zinc-900 hover:bg-zinc-200"
        >
          시작하기
        </Link>
        <Link
          href="/projects"
          className="rounded-lg border border-zinc-700 px-6 py-3 font-medium text-zinc-200 hover:bg-zinc-900"
        >
          내 프로젝트
        </Link>
      </div>
    </main>
  );
}
