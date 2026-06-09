"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reflectAnswer } from "@/lib/ai/enrich";
import type { EnrichQuestion } from "@/lib/ai/enrich";

// 자동 저장: 편집된 HTML 저장 (RLS로 본인 문서만 가능)
export async function saveDocumentHtml(
  documentId: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  if (html.length > 1_000_000) return { ok: false, error: "문서가 너무 큽니다." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("documents")
    .update({ content_html: html }, { count: "exact" })
    .eq("id", documentId);
  if (error || count === 0) return { ok: false, error: "저장에 실패했습니다." };
  return { ok: true };
}

// 보강 질문에 답하면: AI가 문어체로 다듬어 해당 섹션에 추가할 문장 반환 + 질문 answered 처리
export async function answerEnrichQuestion(args: {
  documentId: string;
  questionIndex: number;
  answer: string;
}): Promise<{ ok: true; text: string; section: string } | { ok: false; error: string }> {
  const answer = args.answer.trim();
  if (!answer) return { ok: false, error: "답변을 입력하세요." };
  if (answer.length > 2000) return { ok: false, error: "답변은 2000자 이내로 입력하세요." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  // RLS로 본인 문서만 조회됨
  const { data: doc } = await supabase
    .from("documents")
    .select("id, project_id, enrich_questions")
    .eq("id", args.documentId)
    .single();
  if (!doc) return { ok: false, error: "문서를 찾을 수 없습니다." };

  const questions = (doc.enrich_questions ?? []) as EnrichQuestion[];
  const q = questions[args.questionIndex];
  if (!q) return { ok: false, error: "질문을 찾을 수 없습니다." };

  let text: string;
  try {
    const result = await reflectAnswer({ question: q.question, answer });
    text = result.text;

    const admin = createAdminClient();
    await admin.from("ai_usage_logs").insert({
      user_id: user.id,
      project_id: doc.project_id,
      kind: "enrich_reflect",
      model: result.usage.model,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    });
  } catch {
    return { ok: false, error: "답변 정리에 실패했습니다. 잠시 후 다시 시도하세요." };
  }

  questions[args.questionIndex] = { ...q, answered: true };
  await supabase.from("documents").update({ enrich_questions: questions }).eq("id", args.documentId);

  revalidatePath(`/documents/${args.documentId}`);
  return { ok: true, text, section: q.section };
}
