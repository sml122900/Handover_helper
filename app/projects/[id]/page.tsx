import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VideoUploader } from "./VideoUploader";
import { ScreenRecorder } from "./ScreenRecorder";
import { VideoStatusPoller } from "./VideoStatusPoller";

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
      <Link href="/projects" className="text-sm text-[#C9C7C2] hover:text-white">
        ← 프로젝트 목록
      </Link>
      <h1 className="mt-2 mb-8 text-2xl font-bold text-white">{project.title}</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[#E8E6E0]">영상</h2>
        <div className="flex flex-col gap-3">
          <ScreenRecorder projectId={id} />
          <VideoUploader projectId={id} />
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {(videos ?? []).map((v) => (
            <li
              key={v.id}
              className="rounded-lg border border-[#2A3140] bg-[#161B22] px-4 py-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-[#C9C7C2]">
                  {new Date(v.created_at).toLocaleString("ko-KR")}
                  {v.duration_seconds != null && ` · ${Math.round(v.duration_seconds / 60)}분`}
                </span>
                <span
                  className={`rounded px-2 py-1 text-xs ${STATUS_COLOR[v.status] ?? "bg-[#2A3140] text-[#E8E6E0]"}`}
                >
                  {STATUS_LABEL[v.status] ?? v.status}
                </span>
              </div>
              {v.status === "failed" && v.error_message && (
                <p className="mt-2 text-xs text-red-400">{v.error_message}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-[#E8E6E0]">문서</h2>
        {(documents ?? []).length === 0 ? (
          <p className="text-sm text-[#C9C7C2]">
            아직 생성된 문서가 없습니다. 영상을 업로드하면 자동으로 문서가 만들어집니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(documents ?? []).map((d) => (
              <li key={d.id}>
                <Link
                  href={`/documents/${d.id}`}
                  className="block rounded-lg border border-[#2A3140] bg-[#161B22] px-4 py-3 text-sm text-[#C9C7C2] hover:border-[#3D4760]"
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
