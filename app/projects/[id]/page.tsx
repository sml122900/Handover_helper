import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  uploaded: "업로드됨",
  transcribing: "음성 인식 중",
  structuring: "문서 생성 중",
  done: "완료",
  failed: "실패",
};

export default async function ProjectDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, created_at")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const [{ data: videos }, { data: documents }] = await Promise.all([
    supabase
      .from("videos")
      .select("id, status, duration_seconds, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("documents")
      .select("id, prompt_version, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/projects" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← 프로젝트 목록
      </Link>
      <h1 className="mt-2 mb-8 text-2xl font-bold text-white">{project.title}</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-zinc-200">영상</h2>
        <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
          영상 업로드는 다음 단계(세션 1-2)에서 추가됩니다.
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {(videos ?? []).map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3 text-sm"
            >
              <span className="text-zinc-300">
                {new Date(v.created_at).toLocaleString("ko-KR")}
                {v.duration_seconds != null && ` · ${Math.round(v.duration_seconds / 60)}분`}
              </span>
              <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                {STATUS_LABEL[v.status] ?? v.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-200">문서</h2>
        {(documents ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500">아직 생성된 문서가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(documents ?? []).map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-zinc-800 px-4 py-3 text-sm text-zinc-300"
              >
                문서 ({d.prompt_version}) — {new Date(d.created_at).toLocaleString("ko-KR")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
