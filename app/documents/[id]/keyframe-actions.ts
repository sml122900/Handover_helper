"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocumentSchema } from "@/lib/ai/schema";
import { documentToHtml } from "@/lib/doc-html";
import type { HandoverDocument } from "@/lib/ai/schema";

export interface KeyframeItem {
  id: string;
  timestampSeconds: number;
  imgUrl: string;
}

/** 문서가 속한 프로젝트의 모든 키프레임 목록 (썸네일 팝업용) */
export async function getKeyframesForDocument(
  documentId: string
): Promise<KeyframeItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: doc } = await supabase
    .from("documents")
    .select("project_id")
    .eq("id", documentId)
    .single();
  if (!doc) return [];

  const admin = createAdminClient();
  const { data: videos } = await admin
    .from("videos")
    .select("id")
    .eq("project_id", doc.project_id);
  const videoIds = (videos ?? []).map((v) => v.id);
  if (videoIds.length === 0) return [];

  const { data: keyframes } = await admin
    .from("keyframes")
    .select("id, timestamp_seconds")
    .in("video_id", videoIds)
    .order("timestamp_seconds");

  return (keyframes ?? []).map((k) => ({
    id: k.id,
    timestampSeconds: k.timestamp_seconds,
    imgUrl: `/api/keyframes/${k.id}`,
  }));
}

/** 절차 단계의 keyframeId를 변경 → content + content_html 재생성 */
export async function setKeyframeForStep(
  documentId: string,
  step: number,
  keyframeId: string | null
): Promise<{ ok: true; newHtml: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: doc } = await supabase
    .from("documents")
    .select("id, content")
    .eq("id", documentId)
    .single();
  if (!doc) return { ok: false, error: "문서를 찾을 수 없습니다." };

  const parsed = DocumentSchema.safeParse(doc.content);
  if (!parsed.success) return { ok: false, error: "문서 스키마 파싱 실패" };

  // content에 keyframeId 갱신 (zod 스키마 외 필드이므로 raw content에 직접 병합)
  const rawContent = doc.content as Record<string, unknown>;
  const rawProcedures = Array.isArray((rawContent as { procedures?: unknown[] }).procedures)
    ? [...((rawContent as { procedures: Record<string, unknown>[] }).procedures)]
    : [];

  const updatedProcedures = rawProcedures.map((p) =>
    p.step === step ? { ...p, keyframeId: keyframeId } : p
  );

  const newContent = { ...rawContent, procedures: updatedProcedures };

  // 새 keyframeUrlMap 빌드 (step → /api/keyframes/{id})
  const keyframeUrlMap = new Map<number, string>();
  for (const p of updatedProcedures) {
    if (p.keyframeId && typeof p.keyframeId === "string") {
      keyframeUrlMap.set(p.step as number, `/api/keyframes/${p.keyframeId}`);
    }
  }

  const newHtml = documentToHtml(parsed.data, keyframeUrlMap);

  const { error } = await supabase
    .from("documents")
    .update({ content: newContent, content_html: newHtml })
    .eq("id", documentId);

  if (error) return { ok: false, error: `저장 실패: ${error.message}` };
  return { ok: true, newHtml };
}
