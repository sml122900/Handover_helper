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

  it("잘못된 URL·짧은 CRON_SECRET", () => {
    expect(findEnvProblems({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "abc" }).length).toBe(1);
    expect(findEnvProblems({ ...VALID, CRON_SECRET: "short" }).length).toBe(1);
  });
});
