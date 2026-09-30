import type { SupabaseClient } from "@supabase/supabase-js";

export interface VideoStatusRow {
  id: string;
  status: string;
  stage: string | null;
  error_message: string | null;
  duration_seconds: number | null;
  storage_path: string;
  created_at: string;
  /** 0011 이후 — 없으면 null (멈춤 감지 꺼짐) */
  status_changed_at: string | null;
}

// 영상 목록 조회 — stage(0009)·status_changed_at(0011) 컬럼이 아직 없으면 있는 컬럼만으로 조회 (배포 순서 사고 방지)
export async function selectVideoStatuses(db: SupabaseClient, projectId: string): Promise<VideoStatusRow[]> {
  const base = "id, status, error_message, duration_seconds, storage_path, created_at";
  for (const extra of [", stage, status_changed_at", ", stage", ""]) {
    const res = await db
      .from("videos")
      .select(`${base}${extra}`)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (res.error) continue;
    return ((res.data ?? []) as unknown as Partial<VideoStatusRow>[]).map((v) => ({
      stage: null,
      status_changed_at: null,
      ...v,
    })) as VideoStatusRow[];
  }
  return [];
}
