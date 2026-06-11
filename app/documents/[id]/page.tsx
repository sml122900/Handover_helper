import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { documentToHtml } from "@/lib/doc-html";
import { DocumentSchema } from "@/lib/ai/schema";
import { DocumentEditor } from "./DocumentEditor";
import { EnrichPanel } from "./EnrichPanel";
import { ShareControls } from "./ShareControls";
import { KeyframeManager } from "./KeyframeManager";
import { listShareLinks } from "./share-actions";
import type { EnrichQuestion } from "@/lib/ai/enrich";

export const dynamic = "force-dynamic";

interface ProcedureRaw {
  step: number;
  title: string;
  keyframeId?: string | null;
}

export default async function DocumentPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, project_id, content, content_html, enrich_questions, prompt_version")
    .eq("id", id)
    .single();
  if (!doc) notFound();

  // raw content에서 절차 keyframeId 추출 (zod는 extra fields 제거하므로 raw 사용)
  const rawContent = doc.content as { procedures?: ProcedureRaw[] } | null;
  const keyframeUrlMap = new Map<number, string>();
  const procedureRefs: Array<{ step: number; title: string; keyframeId: string | null }> = [];

  for (const p of rawContent?.procedures ?? []) {
    if (p.keyframeId) {
      keyframeUrlMap.set(p.step, `/api/keyframes/${p.keyframeId}`);
    }
    procedureRefs.push({ step: p.step, title: p.title, keyframeId: p.keyframeId ?? null });
  }

  // 편집본이 있으면 그것, 없으면 AI 산출 JSON에서 초기 HTML 생성 (키프레임 포함)
  let initialHtml = doc.content_html as string | null;
  if (!initialHtml) {
    const parsed = DocumentSchema.safeParse(doc.content);
    initialHtml = parsed.success
      ? documentToHtml(parsed.data, keyframeUrlMap)
      : "<p>문서 내용을 불러올 수 없습니다.</p>";
  }

  const questions = (doc.enrich_questions ?? []) as EnrichQuestion[];
  const shareLinks = await listShareLinks(doc.id);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Link
          href={`/projects/${doc.project_id}`}
          className="text-sm text-[var(--text-sub)] hover:text-[var(--text)]"
        >
          ← 프로젝트로
        </Link>
        <a
          href={`/api/documents/${doc.id}/export-docx`}
          className="rounded-md border border-[var(--card-border)] px-3 py-1.5 text-xs text-[var(--text-sub)] hover:border-[var(--card-border-hover)] hover:text-[var(--text)]"
          download
        >
          📄 Word 내보내기
        </a>
      </div>
      <h1 className="mt-2 mb-6 text-2xl font-bold text-[var(--text)]">인수인계 문서</h1>

      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          <DocumentEditor documentId={doc.id} initialHtml={initialHtml} />
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
          <ShareControls documentId={doc.id} initialLinks={shareLinks} />
          {procedureRefs.length > 0 && (
            <KeyframeManager documentId={doc.id} procedures={procedureRefs} />
          )}
          <EnrichPanel documentId={doc.id} questions={questions} />
        </aside>
      </div>
    </main>
  );
}
