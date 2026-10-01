import { z } from "zod";

// 에이전트 질문 화면(/agent-demo) — 로컬 데모 전용.
// FastAPI(agent/serve.py)는 인증이 없어 127.0.0.1에서만 뜨므로, 화면·프록시는 NEXT_PUBLIC_AGENT_ENABLED=true일 때만 연다(프로덕션 기본 꺼짐).
export const AGENT_DEMO_ENABLED = process.env.NEXT_PUBLIC_AGENT_ENABLED === "true";
export const AGENT_API_BASE = `http://127.0.0.1:${process.env.AGENT_PORT || "8000"}`;

// 가상 매장 5곳 (data/virtual/sN.md 머리말과 같은 이름)
export const DEMO_STORES = [
  { id: "s1", name: "달빛커피", kind: "카페 마감" },
  { id: "s2", name: "보리밭제과", kind: "베이커리 마감" },
  { id: "s3", name: "한빛마트24", kind: "편의점 야간" },
  { id: "s4", name: "오름피트니스", kind: "헬스장 오픈" },
  { id: "s5", name: "동남물류 3센터", kind: "상하차 야간" },
] as const;

const StoreId = z.enum(["s1", "s2", "s3", "s4", "s5"]);
export const AskSchema = z.object({
  store_id: StoreId,
  question: z.string().trim().min(1).max(1000),
  current_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});
export const ConfirmSchema = z.object({
  thread_id: z.string().min(1).max(64),
  approve: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

export type Citation = { n: number; label: string; needs_check: boolean; text?: string };
export type AgentReply = {
  thread_id: string;
  status: string;
  answer: string;
  citations: Citation[];
  confirmation: { tool: string; args: Record<string, unknown>; text: string } | null;
  escalation: { not_in_doc: string; manager_request: string; emergency: string | null } | null;
};

// 답변 한 줄을 조각으로 나눈다: 일반 글자 / **굵게** / [근거 n] / [확인 필요]
export type Piece =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "cite"; n: number }
  | { kind: "check" };

export function parseLine(line: string): Piece[] {
  const out: Piece[] = [];
  const re = /\*\*(.+?)\*\*|\[근거 (\d+)\]|\[확인 필요\]/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push({ kind: "text", text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "cite", n: Number(m[2]) });
    else out.push({ kind: "check" });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

// 근거 조각 표시용: 원문 마크다운 표시(**굵게**, _(영상 m:ss)_)와 고정 길이 청크 경계에서 잘린 첫 줄의 영상 시각 꼬리(예: "57)_")만 걷어 낸다.
// 내용은 바꾸지 않는다
export function cleanSnippet(text: string): string {
  return text
    .replace(/^[\d:~]*\)_[ \t]*\n/, "")
    .replace(/\*\*/g, "")
    .replace(/_\((영상[^)]*)\)_/g, "($1)");
}

// 답변 중 "문서에 없어요"류 문장(일부만 답한 경우)을 다른 스타일로 보이기 위한 판별
export function isNotInDocLine(line: string): boolean {
  return /문서에 없(어요|습니다|다)/.test(line);
}
