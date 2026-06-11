import { z } from "zod";

// 체크리스트 기반 채점 (v2 — 비결정성 해결)
// 정답 문서 → 원자적 사실 체크리스트(1회 생성·캐시) → 심판은 항목별 yes/no만 → 누락률은 코드가 계산

// ── 체크리스트 (build-checklist.ts 산출, golden/{name}-checklist.json) ──

export const ChecklistItemSchema = z.object({
  fact: z.string().describe("정답 문서의 원자적 사실 1개 (검증 가능한 단위로 분해)"),
  section: z.string().describe("8개 섹션 중 해당 섹션 이름"),
  critical: z.boolean().describe("후임자가 모르면 업무 수행이 불가능한 핵심 사실이면 true"),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistSchema = z.object({
  items: z.array(ChecklistItemSchema),
});

// ── 심판 출력 (항목 단위 판정만 — 집계·계산은 코드 담당) ──

export const FactJudgmentSchema = z.object({
  index: z.number().int().describe("체크리스트 항목 번호 (입력 그대로)"),
  present: z.boolean().describe("AI 문서에 이 사실이 존재하는가"),
  evidence: z.string().describe("존재하면 AI 문서에서 해당 부분 인용, 없으면 빈 문자열"),
});

export const ClaimJudgmentSchema = z.object({
  index: z.number().int().describe("AI 문서 주장 번호 (입력 그대로)"),
  supported: z.boolean().describe("트랜스크립트(또는 정답 문서)에 근거가 있는가"),
  evidence: z.string().describe("근거 인용. 근거 없으면 왜 없는지 한 줄"),
});

export const JudgeOutputSchema = z.object({
  factJudgments: z.array(FactJudgmentSchema).describe("체크리스트 전 항목 — 빠짐없이"),
  claimJudgments: z.array(ClaimJudgmentSchema).describe("AI 문서 전 주장 — 빠짐없이"),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ── 최종 채점 결과 (코드가 계산 — results/{name}-eval.json) ──

export const EvalResultSchema = z.object({
  goldenKeyItemCount: z.number().int(),
  missedItems: z.array(
    z.object({ item: z.string(), section: z.string(), critical: z.boolean() })
  ),
  hallucinations: z.array(z.object({ item: z.string(), reason: z.string() })),
  // AI 보완(inferred:true) 주장 — 환각 아님, 작성자 확인 대상 (구 캐시 호환 위해 default)
  inferredClaims: z.array(z.string()).default([]),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

export function missRate(r: EvalResult): number {
  if (r.goldenKeyItemCount === 0) return 0;
  return r.missedItems.length / r.goldenKeyItemCount;
}
