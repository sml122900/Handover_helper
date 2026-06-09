import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { createProject } from "./actions";

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
        <h1 className="text-2xl font-bold text-white">내 프로젝트</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <span>{user?.email}</span>
          <form action={logout}>
            <button className="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-900">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      <form action={createProject} className="mb-8 flex gap-2">
        <input
          name="title"
          required
          maxLength={200}
          placeholder="새 인수인계 프로젝트 이름 (예: 주간 뉴스레터 발송)"
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-zinc-400 focus:outline-none"
        />
        <button className="rounded-md bg-white px-4 py-2 font-medium text-zinc-900 hover:bg-zinc-200">
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
              className="block rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 hover:border-zinc-600"
            >
              <span className="font-medium text-zinc-100">{p.title}</span>
              <span className="ml-3 text-xs text-zinc-500">
                {new Date(p.created_at).toLocaleDateString("ko-KR")}
              </span>
            </Link>
          </li>
        ))}
        {(projects ?? []).length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            아직 프로젝트가 없습니다. 위에서 첫 프로젝트를 만들어 보세요.
          </li>
        )}
      </ul>
    </main>
  );
}
