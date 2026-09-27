// 레이트리밋 한도 (순수 로직 — vitest 대상). env로 조정, 기본값은 PROGRESS.md 세션 3-A 기록
export type RateLimitAction = "pipeline" | "ai_edit";

const DEFAULTS: Record<RateLimitAction, { env: string; perHour: number; message: string }> = {
  // 업로드 완료·재시도 → STT + 구조화 + 보강 질문 (고비용)
  pipeline: {
    env: "RATE_LIMIT_PIPELINE_PER_HOUR",
    perHour: 20,
    message: "짧은 시간에 변환 요청이 너무 많습니다. 1시간 뒤에 다시 시도하세요.",
  },
  // 보강 질문 답변 다듬기 (저비용)
  ai_edit: {
    env: "RATE_LIMIT_AI_EDIT_PER_HOUR",
    perHour: 60,
    message: "짧은 시간에 AI 요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  },
};

export function rateLimitFor(
  action: RateLimitAction,
  env: Record<string, string | undefined> = process.env
): { limit: number; message: string } {
  const d = DEFAULTS[action];
  const n = Number(env[d.env]);
  return { limit: Number.isInteger(n) && n > 0 ? n : d.perHour, message: d.message };
}
