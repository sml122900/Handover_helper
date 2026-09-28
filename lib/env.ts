import { z } from "zod";

// 서버 환경변수 검증 — production 부팅 시 instrumentation.ts가 호출 (누락이면 부팅 실패)
const nonEmpty = z.string().trim().min(1);

const EnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
    SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
    ANTHROPIC_API_KEY: nonEmpty,
    CRON_SECRET: z.string().trim().min(16),
    NEXT_PUBLIC_TOSS_CLIENT_KEY: nonEmpty,
    TOSS_SECRET_KEY: nonEmpty,
    HANDOVER_STT: z.enum(["groq", "whisper", "mock"]).optional(),
    GROQ_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    RATE_LIMIT_PIPELINE_PER_HOUR: z.coerce.number().int().positive().optional(),
    RATE_LIMIT_AI_EDIT_PER_HOUR: z.coerce.number().int().positive().optional(),
    HANDOVER_QUEUE: z.enum(["inngest", "inline"]).optional(),
    INNGEST_EVENT_KEY: z.string().optional(),
    INNGEST_SIGNING_KEY: z.string().optional(),
    SENTRY_DSN: z.url().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  })
  .refine((e) => e.HANDOVER_STT === "mock" || Boolean(e.GROQ_API_KEY || e.OPENAI_API_KEY), {
    message: "STT 키 필요: GROQ_API_KEY 또는 OPENAI_API_KEY (또는 HANDOVER_STT=mock)",
    path: ["GROQ_API_KEY"],
  })
  // 큐 기본값은 Inngest — 운영에서 키가 없으면 업로드 후 변환이 시작되지 않음
  .refine((e) => e.HANDOVER_QUEUE === "inline" || Boolean(e.INNGEST_EVENT_KEY && e.INNGEST_SIGNING_KEY), {
    message: "Inngest 키 필요: INNGEST_EVENT_KEY·INNGEST_SIGNING_KEY (Vercel Inngest Integration) 또는 HANDOVER_QUEUE=inline",
    path: ["INNGEST_EVENT_KEY"],
  });

/** 문제 목록 (키 이름 + 사유만 — 값은 절대 출력하지 않음). 빈 배열 = 정상 */
export function findEnvProblems(env: Record<string, string | undefined> = process.env): string[] {
  // 빈 문자열은 미설정으로 취급 (.env의 "KEY=" 줄)
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const r = EnvSchema.safeParse(cleaned);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}
