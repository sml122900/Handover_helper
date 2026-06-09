import { z } from "zod";

// 채점 결과 스키마 (Claude 심판 출력)

export const MissedItemSchema = z.object({
  item: z.string().describe("정답 문서에 있지만 AI 문서에 빠진 핵심 정보"),
  section: z.string().describe("해당 정보가 속해야 할 섹션"),
});

export const HallucinationSchema = z.object({
  item: z.string().describe("AI 문서에 있지만 근거 없는 내용"),
  reason: z.string().describe("왜 근거가 없다고 판단했는지"),
});

export const SectionScoreSchema = z.object({
  section: z.string(),
  score: z.number().int().describe("0~10점"),
  comment: z.string(),
});

export const EvalResultSchema = z.object({
  goldenKeyItemCount: z.number().int().describe("정답 문서의 핵심 정보 총 개수"),
  missedItems: z.array(MissedItemSchema),
  hallucinations: z.array(HallucinationSchema),
  sectionScores: z.array(SectionScoreSchema).describe("8개 섹션 각각"),
  overallComment: z.string().describe("총평 (강점/약점/개선 방향)"),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;

export function missRate(r: EvalResult): number {
  if (r.goldenKeyItemCount === 0) return 0;
  return r.missedItems.length / r.goldenKeyItemCount;
}
