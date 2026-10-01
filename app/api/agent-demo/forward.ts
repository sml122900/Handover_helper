import { NextResponse } from "next/server";
import { AGENT_API_BASE } from "@/lib/agent-demo";

const UNREACHABLE =
  "에이전트 서버에 연결할 수 없어요. 터미널에서 `npm run agent:serve`로 에이전트를 띄운 뒤 다시 시도해 주세요.";

// 에이전트 API의 상태 코드와 한국어 오류 문구(detail)는 그대로 전달하고, 연결 실패만 안내 문구로 바꾼다
export async function forwardToAgent(path: "/ask" | "/confirm", body: unknown) {
  let res: Response;
  try {
    res = await fetch(`${AGENT_API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: UNREACHABLE }, { status: 503 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "요청을 처리하지 못했어요. 다시 시도해 주세요.";
    return NextResponse.json({ error: detail }, { status: res.status });
  }
  return NextResponse.json(data);
}
