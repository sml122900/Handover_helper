import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Vercel cron이 매일 자정 GET으로 호출 — CRON_SECRET Bearer 토큰으로 인증
// 30일 이상 된 영상 원본(Storage 파일) + 키프레임 이미지 삭제
// 주의: documents는 보존 (project_id FK, video_id FK 아님)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const staleAudioChunks = await sweepStaleAudioChunks(admin, cutoff);

  const { data: videos } = await admin
    .from("videos")
    .select("id, storage_path")
    .lt("created_at", cutoff)
    .not("storage_path", "is", null);

  if (!videos?.length) {
    return NextResponse.json({ deleted: 0, staleAudioChunks });
  }

  let deleted = 0;
  const errors: string[] = [];

  for (const video of videos) {
    try {
      // 1) 키프레임 이미지 Storage 삭제
      const { data: keyframes } = await admin
        .from("keyframes")
        .select("image_path")
        .eq("video_id", video.id);

      if (keyframes?.length) {
        await admin.storage
          .from("keyframes")
          .remove(keyframes.map((k: { image_path: string }) => k.image_path));
      }

      // 2) 영상 원본 + 남은 임시 오디오 청크 Storage 삭제
      await admin.storage.from("videos").remove([video.storage_path]);
      await removeAudioChunks(admin, video.storage_path, () => true);

      // 3) DB video 행 삭제 — CASCADE로 transcripts·keyframes 행도 삭제
      await admin.from("videos").delete().eq("id", video.id);

      deleted++;
    } catch (e) {
      errors.push(`${video.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`[cron/cleanup-videos] deleted=${deleted} errors=${errors.length}`);
  return NextResponse.json({ deleted, staleAudioChunks, ...(errors.length > 0 && { errors }) });
}

// 파이프라인 임시 오디오 청크({경로}.audio/) 중 하루 이상 된 것 삭제 — 성공·실패 경로의 삭제가 실패했을 때 안전망
async function sweepStaleAudioChunks(admin: ReturnType<typeof createAdminClient>, since: string): Promise<number> {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const { data: recent } = await admin.from("videos").select("storage_path").gte("created_at", since);
  let removed = 0;
  for (const v of recent ?? []) {
    removed += await removeAudioChunks(admin, v.storage_path, (createdAt) => createdAt < dayAgo);
  }
  return removed;
}

async function removeAudioChunks(
  admin: ReturnType<typeof createAdminClient>,
  storagePath: string,
  shouldRemove: (createdAtMs: number) => boolean
): Promise<number> {
  const dir = `${storagePath}.audio`;
  const { data } = await admin.storage.from("videos").list(dir);
  const targets = (data ?? []).filter((f) => shouldRemove(new Date(f.created_at ?? 0).getTime()));
  if (targets.length > 0) await admin.storage.from("videos").remove(targets.map((f) => `${dir}/${f.name}`));
  return targets.length;
}
