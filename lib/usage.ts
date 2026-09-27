import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_PLAN, PAID_PLAN, type Plan } from "./plan";

// 비용 가드용 누적 사용량 (초, failed 제외) — paid: 프로젝트 단위 2시간, free: 계정 전체 20분
export async function getPlanUsage(
  admin: SupabaseClient,
  args: { projectId: string; ownerId: string; projectPlan: string; excludeVideoId?: string }
): Promise<{ plan: Plan; usedSeconds: number }> {
  const plan = args.projectPlan === "paid" ? PAID_PLAN : FREE_PLAN;
  let projectIds = [args.projectId];
  if (args.projectPlan !== "paid") {
    const { data: myProjects } = await admin.from("projects").select("id").eq("owner_id", args.ownerId);
    projectIds = (myProjects ?? []).map((p) => p.id);
    if (projectIds.length === 0) return { plan, usedSeconds: 0 };
  }
  const { data: videos } = await admin
    .from("videos")
    .select("id, duration_seconds, status")
    .in("project_id", projectIds);
  const usedSeconds = (videos ?? [])
    .filter((v) => v.status !== "failed" && v.id !== args.excludeVideoId)
    .reduce((sum, v) => sum + (v.duration_seconds ?? 0), 0);
  return { plan, usedSeconds };
}
