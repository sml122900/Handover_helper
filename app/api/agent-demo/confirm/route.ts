import { NextResponse } from "next/server";
import { AGENT_DEMO_ENABLED, ConfirmSchema } from "@/lib/agent-demo";
import { forwardToAgent } from "../forward";

export const dynamic = "force-dynamic";

// 로컬 데모 전용 프록시: 쓰기 도구 확인 카드의 승인·거절 → 127.0.0.1 에이전트 API(/confirm)
export async function POST(req: Request) {
  if (!AGENT_DEMO_ENABLED) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = ConfirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "확인 요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  return forwardToAgent("/confirm", parsed.data);
}
