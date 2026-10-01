import { NextResponse } from "next/server";
import { AGENT_DEMO_ENABLED, AskSchema } from "@/lib/agent-demo";
import { forwardToAgent } from "../forward";

export const dynamic = "force-dynamic";

// 로컬 데모 전용 프록시: 브라우저 → 이 라우트 → 127.0.0.1 에이전트 API(/ask)
export async function POST(req: Request) {
  if (!AGENT_DEMO_ENABLED) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = AskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "매장·질문(1~1000자)·시각(HH:MM)을 확인해 주세요." },
      { status: 400 },
    );
  }
  return forwardToAgent("/ask", parsed.data);
}
