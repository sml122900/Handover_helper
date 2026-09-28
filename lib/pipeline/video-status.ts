import type { SupabaseClient } from "@supabase/supabase-js";

export interface VideoStatusRow {
  id: string;
  status: string;
  stage: string | null;
  error_message: string | null;
  duration_seconds: number | null;
  storage_path: string;
  created_at: string;
}

// 영상 목록 조회 — stage 컬럼(0009)이 아직 없으면 status만으로 조회 (배포 순서 사고 방지)
export async function selectVideoStatuses(db: SupabaseClient, projectId: string): Promise<VideoStatusRow[]> {
  const base = "id, status, error_message, duration_seconds, storage_path, created_at";
  const withStage = await db
    .from("videos")
    .select(`${base}, stage`)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (!withStage.error) return (withStage.data ?? []) as VideoStatusRow[];

  const fallback = await db
    .from("videos")
    .select(base)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return ((fallback.data ?? []) as Omit<VideoStatusRow, "stage">[]).map((v) => ({ ...v, stage: null }));
}
