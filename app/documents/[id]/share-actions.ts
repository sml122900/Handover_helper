"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ShareLink {
  id: string;
  token: string;
  expires_at: string | null;
  created_at: string;
}

// RLS가 소유권 강제 — 본인 문서의 링크만 생성/조회/삭제 가능

export async function createShareLink(args: {
  documentId: string;
  /** 만료까지 일수. null = 무기한 */
  expiresInDays: number | null;
}): Promise<{ ok: true; link: ShareLink } | { ok: false; error: string }> {
  if (args.expiresInDays !== null && (args.expiresInDays < 1 || args.expiresInDays > 365)) {
    return { ok: false, error: "만료일은 1~365일 사이여야 합니다." };
  }
  const supabase = await createClient();

  const token = randomBytes(32).toString("base64url"); // 추측 불가능
  const expiresAt =
    args.expiresInDays === null
      ? null
      : new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("share_links")
    .insert({ document_id: args.documentId, token, expires_at: expiresAt })
    .select("id, token, expires_at, created_at")
    .single();
  if (error || !data) return { ok: false, error: "공유 링크 생성에 실패했습니다." };

  revalidatePath(`/documents/${args.documentId}`);
  return { ok: true, link: data };
}

export async function revokeShareLink(
  linkId: string,
  documentId: string
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  await supabase.from("share_links").delete().eq("id", linkId);
  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}

export async function listShareLinks(documentId: string): Promise<ShareLink[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("share_links")
    .select("id, token, expires_at, created_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  return data ?? [];
}
