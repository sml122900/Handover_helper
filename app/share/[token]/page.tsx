import Link from "next/link";
import { notFound } from "next/navigation";
import sanitizeHtml from "sanitize-html";
import { createAdminClient } from "@/lib/supabase/admin";
import { documentToHtml } from "@/lib/doc-html";
import { DocumentSchema } from "@/lib/ai/schema";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

// 공개 읽기 전용 뷰 — 토큰으로만 접근 (로그인 불필요), 만료 검사
export default async function SharePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("share_links")
    .select("document_id, expires_at")
    .eq("token", token)
    .single();
  if (!link) notFound();

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
        <p className="text-lg text-[var(--text)]">이 공유 링크는 만료되었습니다.</p>
        <p className="mt-2 text-sm text-[var(--text-sub)]">문서 작성자에게 새 링크를 요청하세요.</p>
      </main>
    );
  }

  const { data: doc } = await admin
    .from("documents")
    .select("content, content_html")
    .eq("id", link.document_id)
    .single();
  if (!doc) notFound();

  let html = doc.content_html as string | null;
  if (!html) {
    const parsed = DocumentSchema.safeParse(doc.content);
    if (!parsed.success) notFound();
    html = documentToHtml(parsed.data);
  }
  // 작성자 편집 HTML을 제3자에게 보여주므로 sanitize (XSS 방지)
  const safeHtml = sanitizeHtml(html, {
    allowedTags: ["h1", "h2", "h3", "p", "ul", "ol", "li", "strong", "em", "mark", "code", "br", "a", "img"],
    allowedAttributes: { a: ["href"], img: ["src", "alt", "style"] },
    allowedSchemes: ["http", "https"],
    // /api/keyframes/* 경로 허용 (상대 경로 — 스킴 없음)
    allowedSchemesAppliedToAttributes: ["href"],
  })
    // 키프레임 이미지는 공유 토큰으로 접근 검증 (/api/keyframes/[id]?share=)
    .replace(/src="\/api\/keyframes\/([0-9a-f-]{36})"/g, `src="/api/keyframes/$1?share=${token}"`);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <span className="text-sm text-[var(--text-sub)]">읽기 전용 공유 문서</span>
        <PrintButton />
      </div>

      <article
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-6 py-4 text-sm leading-relaxed text-[var(--text)]
          [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[var(--text)]
          [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1
          [&_mark]:bg-[var(--accent-bg)] [&_mark]:border-l-[3px] [&_mark]:border-l-[var(--accent)] [&_mark]:pl-2 [&_mark]:py-0.5 [&_mark]:rounded-r [&_mark]:text-[var(--text)]
          [&_em]:text-xs [&_em]:italic [&_em]:text-[var(--accent)]
          [&_strong]:text-[var(--text)] [&_p]:text-[var(--text)] [&_li]:text-[var(--text)]
          print:border-0 print:bg-white print:text-zinc-900
          print:[&_h2]:text-zinc-900 print:[&_strong]:text-zinc-900 print:[&_em]:text-zinc-600 print:[&_li]:text-zinc-900 print:[&_p]:text-zinc-900"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />

      {/* 가입 유도 배너 (바이럴 루프) */}
      <div className="mt-8 rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-6 text-center print:hidden">
        <p className="text-[var(--text)]">
          이 문서는 <strong>Handover</strong>로 만들었습니다.
        </p>
        <p className="mt-1 text-sm text-[var(--text-sub)]">
          퇴사 전 30분 녹화로, 한 달치 인수인계를 끝내세요.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-md bg-[var(--text)] px-5 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-80"
        >
          무료로 시작하기
        </Link>
      </div>
    </main>
  );
}
