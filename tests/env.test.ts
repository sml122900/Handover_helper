import { describe, it, expect } from "vitest";
import { findEnvProblems } from "../lib/env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  ANTHROPIC_API_KEY: "sk-ant-x",
  CRON_SECRET: "0123456789abcdef",
  NEXT_PUBLIC_TOSS_CLIENT_KEY: "test_ck",
  TOSS_SECRET_KEY: "test_sk",
  GROQ_API_KEY: "gsk",
  INNGEST_EVENT_KEY: "evt",
  INNGEST_SIGNING_KEY: "signkey-prod-x",
};

describe("findEnvProblems", () => {
  it("정상", () => expect(findEnvProblems(VALID)).toEqual([]));

  it("누락 키 이름을 보고하고 값은 출력하지 않음", () => {
    const problems = findEnvProblems({ ...VALID, SUPABASE_SERVICE_ROLE_KEY: "", ANTHROPIC_API_KEY: undefined });
    expect(problems.some((p) => p.startsWith("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
    expect(problems.some((p) => p.startsWith("ANTHROPIC_API_KEY"))).toBe(true);
    expect(problems.join()).not.toContain("sk-ant-x");
  });

  it("STT 키 없으면 실패, HANDOVER_STT=mock이면 통과", () => {
    const noStt = { ...VALID, GROQ_API_KEY: undefined };
    expect(findEnvProblems(noStt).length).toBe(1);
    expect(findEnvProblems({ ...noStt, HANDOVER_STT: "mock" })).toEqual([]);
  });

  it("큐 기본값(inngest)은 Inngest 키 필요, HANDOVER_QUEUE=inline이면 불필요", () => {
    const noInngest = { ...VALID, INNGEST_EVENT_KEY: undefined, INNGEST_SIGNING_KEY: undefined };
    expect(findEnvProblems(noInngest).some((p) => p.startsWith("INNGEST_EVENT_KEY"))).toBe(true);
    expect(findEnvProblems({ ...noInngest, HANDOVER_QUEUE: "inline" })).toEqual([]);
    expect(findEnvProblems({ ...VALID, HANDOVER_QUEUE: "sqs" }).length).toBe(1);
  });

  it("운영에서 INNGEST_DEV 설정 금지 (서명 검증 우회 방지), 개발에서는 허용", () => {
    expect(findEnvProblems({ ...VALID, NODE_ENV: "production", INNGEST_DEV: "1" }).some((p) => p.startsWith("INNGEST_DEV"))).toBe(true);
    expect(findEnvProblems({ ...VALID, NODE_ENV: "development", INNGEST_DEV: "1" })).toEqual([]);
  });

  it("잘못된 URL·짧은 CRON_SECRET", () => {
    expect(findEnvProblems({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "abc" }).length).toBe(1);
    expect(findEnvProblems({ ...VALID, CRON_SECRET: "short" }).length).toBe(1);
  });
});
