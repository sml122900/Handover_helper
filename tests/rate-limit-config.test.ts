import { describe, it, expect } from "vitest";
import { rateLimitFor } from "../lib/rate-limit-config";

describe("rateLimitFor", () => {
  it("기본값", () => {
    expect(rateLimitFor("pipeline", {}).limit).toBe(20);
    expect(rateLimitFor("ai_edit", {}).limit).toBe(60);
  });
  it("env override", () => {
    expect(rateLimitFor("pipeline", { RATE_LIMIT_PIPELINE_PER_HOUR: "5" }).limit).toBe(5);
  });
  it.each(["0", "-1", "abc", "1.5"])("잘못된 env(%s)는 기본값", (v) => {
    expect(rateLimitFor("ai_edit", { RATE_LIMIT_AI_EDIT_PER_HOUR: v }).limit).toBe(60);
  });
});
