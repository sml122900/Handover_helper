import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 키프레임 이미지 프록시: keyframe UUID → Supabase Storage 서명 URL → 307 리다이렉트
// 인증 없음 — UUID 자체가 불투명 키 (MVP 허용, Phase 2에서 문서 소유권 검증 추가 예정)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const admin = createAdminClient();
  const { data: kf } = await admin
    .from("keyframes")
    .select("image_path")
    .eq("id", id)
    .single();

  if (!kf?.image_path) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { data: signed, error } = await admin.storage
    .from("keyframes")
    .createSignedUrl(kf.image_path, 3600);

  if (error || !signed?.signedUrl) {
    return new NextResponse("Storage 오류", { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl, { status: 307 });
}
