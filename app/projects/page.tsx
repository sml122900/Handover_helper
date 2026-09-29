import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { createProject } from "./actions";
import { formatDate } from "@/lib/format-date";

export const dynamic = "force-dynamic";

export default async function ProjectsPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await props.searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text)]">내 프로젝트</h1>
        <div className="flex items-center gap-3 text-sm text-[var(--text-sub)]">
          <span>{user?.email}</span>
          <form action={logout}>
            <button className="rounded-md border border-[var(--card-border)] px-3 py-1 text-[var(--text-sub)] hover:text-[var(--text)] hover:border-[var(--card-border-hover)]">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      <form id="project-create" action={createProject} className="mb-8 flex gap-2">
        <input
          name="title"
          required
          maxLength={200}
          placeholder="새 인수인계 프로젝트 이름 (예: 주간 뉴스레터 발송)"
          className="flex-1 rounded-md border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-sub)] focus:border-[var(--text-sub)] focus:outline-none"
        />
        <button className="rounded-md bg-[var(--text)] px-4 py-2 font-medium text-[var(--bg)] hover:opacity-80">
          만들기
        </button>
      </form>
      {error && (
        <p className="mb-4 text-sm text-red-400">
          {error === "title" ? "프로젝트 이름을 확인하세요 (200자 이내)." : "프로젝트 생성에 실패했습니다."}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {(projects ?? []).map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className="block rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 hover:border-[var(--card-border-hover)]"
            >
              <span className="font-medium text-[var(--text)]">{p.title}</span>
              <span className="ml-3 text-xs text-[var(--text-sub)]">
                {formatDate(p.created_at)}
              </span>
            </Link>
          </li>
        ))}
        {(projects ?? []).length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--card-border)] px-4 py-10 text-center text-sm">
            <p className="text-[var(--text-sub)]">아직 프로젝트가 없습니다.</p>
            <a
              href="#project-create"
              className="mt-3 inline-block rounded-md border border-[var(--card-border)] px-4 py-1.5 text-xs text-[var(--text-sub)] hover:border-[var(--card-border-hover)] hover:text-[var(--text)]"
            >
              ↑ 첫 프로젝트 만들기
            </a>
          </li>
        )}
      </ul>
    </main>
  );
}
