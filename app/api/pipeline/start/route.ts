import { NextResponse } from "next/server";
import { z } from "zod";
import { createClientForToken } from "@/lib/supabase/token";
import { startPipeline } from "@/lib/pipeline/start";

// 업로드 완료 → 변환 시작 (배포 URL e2e·스크립트용). completeUpload 서버 액션과 같은 startPipeline만 호출
// (소유권 = 호출자 토큰의 RLS, 매직 넘버·용량 재검증, 레이트리밋 모두 startPipeline 안에서)
const BodySchema = z.object({ videoId: z.uuid() });

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "videoId(UUID)가 필요합니다." }, { status: 400 });
  }

  const supabase = createClientForToken(token);
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });

  const result = await startPipeline(supabase, user.id, body.data.videoId);
  return NextResponse.json(result, { status: result.ok ? 202 : 400 });
}
