import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// 키프레임 접근 검증 (service_role 조회용 — 호출자는 프로젝트 접근 권한을 먼저 확인할 것)

/** 키프레임이 해당 프로젝트 영상의 것일 때만 image_path 반환 (문서 content의 keyframeId는 사용자가 편집 가능) */
export async function keyframePathInProject(
  admin: SupabaseClient,
  keyframeId: string,
  projectId: string
): Promise<string | null> {
  const { data } = await admin
    .from("keyframes")
    .select("image_path, videos!inner(project_id)")
    .eq("id", keyframeId)
    .eq("videos.project_id", projectId)
    .maybeSingle();
  return (data?.image_path as string | undefined) ?? null;
}

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** 공유 토큰이 존재하고 만료 전이면 문서·프로젝트 ID (만료는 서버 시각 기준) */
export async function resolveShareToken(
  admin: SupabaseClient,
  token: string
): Promise<{ documentId: string; projectId: string } | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const { data: link } = await admin
    .from("share_links")
    .select("document_id, expires_at, documents!inner(project_id)")
    .eq("token", token)
    .maybeSingle();
  if (!link) return null;
  if (link.expires_at && new Date(link.expires_at) < new Date()) return null;
  const doc = link.documents as unknown as { project_id: string };
  return { documentId: link.document_id, projectId: doc.project_id };
}
