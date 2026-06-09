import { describe, it, expect } from "vitest";
import { checkUploadAllowed, FREE_PLAN, PAID_PLAN } from "../lib/plan";

describe("checkUploadAllowed (비용 가드)", () => {
  it("한도 내 업로드 허용", () => {
    expect(
      checkUploadAllowed({ plan: FREE_PLAN, usedSeconds: 0, newDurationSeconds: 10 * 60 })
    ).toEqual({ allowed: true });
  });

  it("누적 + 신규가 플랜 총량 초과 시 차단", () => {
    const r = checkUploadAllowed({
      plan: FREE_PLAN,
      usedSeconds: 15 * 60,
      newDurationSeconds: 6 * 60,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toContain("플랜 한도");
  });

  it("정확히 한도까지는 허용 (경계값)", () => {
    expect(
      checkUploadAllowed({ plan: FREE_PLAN, usedSeconds: 10 * 60, newDurationSeconds: 10 * 60 })
    ).toEqual({ allowed: true });
  });

  it("한도 + 1초는 차단 (경계값)", () => {
    const r = checkUploadAllowed({
      plan: FREE_PLAN,
      usedSeconds: 10 * 60,
      newDurationSeconds: 10 * 60 + 1,
    });
    expect(r.allowed).toBe(false);
  });

  it("영상 1개 한도 초과 차단 (paid 2시간)", () => {
    const r = checkUploadAllowed({
      plan: PAID_PLAN,
      usedSeconds: 0,
      newDurationSeconds: 121 * 60,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toContain("영상 1개 한도");
  });

  it("길이 불명(NaN/음수) 차단", () => {
    expect(
      checkUploadAllowed({ plan: FREE_PLAN, usedSeconds: 0, newDurationSeconds: NaN }).allowed
    ).toBe(false);
    expect(
      checkUploadAllowed({ plan: FREE_PLAN, usedSeconds: 0, newDurationSeconds: -1 }).allowed
    ).toBe(false);
  });

  it("트랜스크립트 업로드(0초)는 항상 허용", () => {
    expect(
      checkUploadAllowed({ plan: FREE_PLAN, usedSeconds: 20 * 60, newDurationSeconds: 0 })
    ).toEqual({ allowed: true });
  });
});
