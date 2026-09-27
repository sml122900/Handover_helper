import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { keyframePathInProject, resolveShareToken } from "@/lib/keyframe-access";

// 키프레임 이미지 프록시: 접근 검증 → Supabase Storage 서명 URL → 307 리다이렉트
//   ?share={token}: 유효·미만료 공유 토큰 + 키프레임이 그 문서 프로젝트 소속일 때만
//   토큰 없음: 로그인 사용자 RLS 조회 (본인 프로젝트 키프레임만)
// 실패 사유는 구분하지 않고 404 (존재 여부 노출 방지)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new NextResponse("Not Found", { status: 404 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();

  const admin = createAdminClient();
  const share = new URL(req.url).searchParams.get("share");
  let imagePath: string | null = null;

  if (share) {
    const link = await resolveShareToken(admin, share);
    if (link) imagePath = await keyframePathInProject(admin, id, link.projectId);
  } else {
    const supabase = await createClient();
    const { data } = await supabase.from("keyframes").select("image_path").eq("id", id).maybeSingle();
    imagePath = data?.image_path ?? null;
  }
  if (!imagePath) return notFound();

  const { data: signed, error } = await admin.storage.from("keyframes").createSignedUrl(imagePath, 300);
  if (error || !signed?.signedUrl) {
    return new NextResponse("이미지를 불러오지 못했습니다. 잠시 후 다시 시도하세요.", { status: 500 });
  }

  const res = NextResponse.redirect(signed.signedUrl, { status: 307 });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
