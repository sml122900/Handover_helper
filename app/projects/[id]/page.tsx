import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VideoUploader } from "./VideoUploader";
import { ScreenRecorder } from "./ScreenRecorder";
import { VideoStatusPoller } from "./VideoStatusPoller";
import { retryVideo } from "./upload-actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  uploaded: "업로드됨 · 처리 대기",
  transcribing: "음성 인식 중",
  structuring: "문서 생성 중",
  done: "완료",
  failed: "실패",
};

const STATUS_COLOR: Record<string, string> = {
  done: "bg-emerald-900 text-emerald-200",
  failed: "bg-red-900 text-red-200",
};

const PROCESSING = new Set(["uploaded", "transcribing", "structuring"]);

export default async function ProjectDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, created_at, plan")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const [{ data: videos }, { data: documents }] = await Promise.all([
    supabase
      .from("videos")
      .select("id, status, duration_seconds, error_message, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("documents")
      .select("id, prompt_version, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <VideoStatusPoller projectId={id} statuses={(videos ?? []).map((v) => v.status)} />
      <Link href="/projects" className="text-sm text-[var(--text-sub)] hover:text-[var(--text)]">
        ← 프로젝트 목록
      </Link>
      <div className="mt-2 mb-8 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-[var(--text)]">{project.title}</h1>
        {project.plan === "paid" ? (
          <span className="rounded-full bg-emerald-900 px-2.5 py-0.5 text-xs font-semibold text-emerald-200">PRO</span>
        ) : (
          <Link
            href={`/projects/${id}/upgrade`}
            className="rounded-full border border-[var(--card-border)] px-2.5 py-0.5 text-xs text-[var(--text-sub)] hover:border-[var(--card-border-hover)] hover:text-[var(--text)]"
          >
            업그레이드
          </Link>
        )}
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--text)]">영상</h2>
        <div className="flex flex-col gap-3">
          <ScreenRecorder projectId={id} />
          <VideoUploader projectId={id} />
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {(videos ?? []).map((v) => (
            <li
              key={v.id}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-sub)]">
                  {new Date(v.created_at).toLocaleString("ko-KR")}
                  {v.duration_seconds != null && ` · ${Math.round(v.duration_seconds / 60)}분`}
                </span>
                <span
                  className={`rounded px-2 py-1 text-xs ${STATUS_COLOR[v.status] ?? "bg-[var(--card-border)] text-[var(--text)]"} ${PROCESSING.has(v.status) ? "animate-pulse" : ""}`}
                >
                  {STATUS_LABEL[v.status] ?? v.status}
                </span>
              </div>
              {v.status === "failed" && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {v.error_message && (
                    <p className="flex-1 text-xs text-red-400">{v.error_message}</p>
                  )}
                  <form action={retryVideo}>
                    <input type="hidden" name="videoId" value={v.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--card-border)] px-3 py-1 text-xs text-[var(--text-sub)] hover:border-[var(--card-border-hover)] hover:text-[var(--text)]"
                    >
                      재시도
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-[var(--text)]">문서</h2>
        {(documents ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--card-border)] px-4 py-8 text-center text-sm">
            <p className="text-[var(--text-sub)]">아직 생성된 문서가 없습니다.</p>
            <p className="mt-1 text-xs text-[var(--text-sub)]">↑ 위에서 영상을 업로드하면 자동으로 만들어집니다.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {(documents ?? []).map((d) => (
              <li key={d.id}>
                <Link
                  href={`/documents/${d.id}`}
                  className="block rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text-sub)] hover:border-[var(--card-border-hover)]"
                >
                  📄 문서 열기 ({d.prompt_version}) — {new Date(d.created_at).toLocaleString("ko-KR")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
