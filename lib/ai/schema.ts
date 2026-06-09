import { z } from "zod";

// 문서 스키마 (CLAUDE.md 고정 8개 섹션 — 임의 변경 금지)
// 각 항목: sourceTimestamp(원본 영상 구간, 초) + confidence(high/needs_review)

export const ConfidenceSchema = z.enum(["high", "needs_review"]);

// 트랜스크립트에 타임스탬프가 없으면 null
export const SourceTimestampSchema = z
  .object({
    start: z.number().describe("구간 시작 (초)"),
    end: z.number().describe("구간 끝 (초)"),
  })
  .nullable();

const itemBase = {
  sourceTimestamp: SourceTimestampSchema,
  confidence: ConfidenceSchema,
};

export const OverviewSchema = z.object({
  summary: z.string().describe("업무 한 줄 요약"),
  cycle: z.string().nullable().describe("업무 주기 (예: 매주 월요일). 없으면 null"),
  importance: z.enum(["high", "medium", "low"]).nullable(),
  ...itemBase,
});

export const ProcedureStepSchema = z.object({
  step: z.number().int().describe("단계 번호 (1부터)"),
  title: z.string(),
  details: z.string(),
  ...itemBase,
});

export const AccountSchema = z.object({
  system: z.string().describe("시스템/서비스 이름"),
  account: z.string().nullable().describe("계정 ID. 비밀번호류는 절대 포함 금지 — *** 마스킹"),
  notes: z.string().nullable().describe("권한 요청 방법 등. 비밀번호류는 *** 마스킹"),
  ...itemBase,
});

export const StakeholderSchema = z.object({
  name: z.string(),
  role: z.string(),
  relationship: z.string().nullable().describe("요청/보고 관계 (예: 매주 보고, 자료 요청처)"),
  ...itemBase,
});

export const ScheduleSchema = z.object({
  title: z.string(),
  when: z.string().describe("일정/데드라인 (예: 매월 25일, 6월 말)"),
  details: z.string().nullable(),
  ...itemBase,
});

export const NoteItemSchema = z.object({
  content: z.string(),
  ...itemBase,
});

export const FaqSchema = z.object({
  question: z.string(),
  answer: z.string(),
  ...itemBase,
});

export const DocumentSchema = z.object({
  overview: OverviewSchema.describe("1. 업무 개요"),
  procedures: z.array(ProcedureStepSchema).describe("2. 업무 절차"),
  accounts: z.array(AccountSchema).describe("3. 계정·접근 권한"),
  stakeholders: z.array(StakeholderSchema).describe("4. 관계자 맵"),
  schedules: z.array(ScheduleSchema).describe("5. 일정·데드라인"),
  cautions: z.array(NoteItemSchema).describe("6. 주의사항·암묵지"),
  openIssues: z.array(NoteItemSchema).describe("7. 미해결 이슈"),
  faq: z.array(FaqSchema).describe("8. FAQ"),
});

export type HandoverDocument = z.infer<typeof DocumentSchema>;
