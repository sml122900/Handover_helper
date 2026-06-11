import { z } from "zod";

// 문서 스키마 v2 (CLAUDE.md 고정 8개 섹션 — 직종 보편형, 임의 변경 금지)
// 각 항목: sourceTimestamp(원본 영상 구간, 초) + confidence(high/needs_review)
// 절차 항목만 추가로 inferred(AI 추론 보완 여부)
// 주의: structured output grammar 한도 → describe는 최소화, 작성 지침은 structure-v2 프롬프트에

export const ConfidenceSchema = z.enum(["high", "needs_review"]);

// 트랜스크립트에 타임스탬프가 없으면 null
export const SourceTimestampSchema = z
  .object({
    start: z.number(),
    end: z.number(),
  })
  .nullable();

const itemBase = {
  sourceTimestamp: SourceTimestampSchema,
  confidence: ConfidenceSchema,
};

export const OverviewSchema = z.object({
  summary: z.string(),
  cycle: z.string().nullable(),
  importance: z.enum(["high", "medium", "low"]).nullable(),
  ...itemBase,
});

// inferred는 절차에만: AI 보완 원칙 = "생략된 단계"를 추론으로 채움 (라벨 필수, 라벨 없는 추론 = 환각)
// (전 항목에 두면 structured output grammar 한도 초과 — 2026-06-11 400 에러로 확인)
export const ProcedureStepSchema = z.object({
  step: z.number().int(),
  title: z.string(),
  details: z.string(),
  inferred: z.boolean().describe("AI 추론 보완 단계면 true"),
  ...itemBase,
});

export const EquipmentSchema = z.object({
  name: z.string(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  ...itemBase,
});

export const RoutineSchema = z.object({
  title: z.string(),
  when: z.string(),
  details: z.string().nullable(),
  ...itemBase,
});

export const ContactSchema = z.object({
  name: z.string(),
  role: z.string(),
  contact: z.string().nullable(),
  relationship: z.string().nullable(),
  ...itemBase,
});

export const ExceptionTipSchema = z.object({
  situation: z.string(),
  tip: z.string(),
  ...itemBase,
});

export const NoteItemSchema = z.object({
  content: z.string(),
  ...itemBase,
});

export const DocumentSchema = z.object({
  overview: OverviewSchema.describe("1. 업무 개요"),
  procedures: z.array(ProcedureStepSchema).describe("2. 절차"),
  equipment: z.array(EquipmentSchema).describe("3. 장비·위치·물품"),
  routines: z.array(RoutineSchema).describe("4. 일정·루틴"),
  contacts: z.array(ContactSchema).describe("5. 연락·보고"),
  exceptions: z.array(ExceptionTipSchema).describe("6. 예외 상황·꿀팁"),
  cautions: z.array(NoteItemSchema).describe("7. 주의사항"),
  openItems: z.array(NoteItemSchema).describe("8. 미해결·인계 항목"),
});

export type HandoverDocument = z.infer<typeof DocumentSchema>;
