import { describe, test, expect } from "vitest";
import { validateConfirmRequest } from "./confirm-logic";

describe("validateConfirmRequest — 금액 검증 및 상태 검사", () => {
  test("금액 일치 + pending → ok", () => {
    const result = validateConfirmRequest({ queryAmount: 9900, dbAmount: 9900, dbStatus: "pending" });
    expect(result.ok).toBe(true);
  });

  test("금액 변조 → 거부 (금액 언급)", () => {
    const result = validateConfirmRequest({ queryAmount: 100, dbAmount: 9900, dbStatus: "pending" });
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/금액/);
  });

  test("금액을 0원으로 변조 → 거부", () => {
    const result = validateConfirmRequest({ queryAmount: 0, dbAmount: 9900, dbStatus: "pending" });
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/금액/);
  });

  test("이미 confirmed → 거부 (이미 언급)", () => {
    const result = validateConfirmRequest({ queryAmount: 9900, dbAmount: 9900, dbStatus: "confirmed" });
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/이미/);
  });

  test("failed 상태 → 거부", () => {
    const result = validateConfirmRequest({ queryAmount: 9900, dbAmount: 9900, dbStatus: "failed" });
    expect(result.ok).toBe(false);
  });

  test("음수 금액 → 거부", () => {
    const result = validateConfirmRequest({ queryAmount: -100, dbAmount: 9900, dbStatus: "pending" });
    expect(result.ok).toBe(false);
  });

  test("NaN 금액 → 거부", () => {
    const result = validateConfirmRequest({ queryAmount: NaN, dbAmount: 9900, dbStatus: "pending" });
    expect(result.ok).toBe(false);
  });
});
