import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { maskSensitive, maskDeep } from "../lib/privacy/mask";

// 케이스는 agent/tests/test_mask.py와 공유 (tests/fixtures/mask-cases.json)
const { cases } = JSON.parse(readFileSync("tests/fixtures/mask-cases.json", "utf8")) as {
  cases: { name: string; input: string; expected: string }[];
};

describe("maskSensitive — 공유 케이스 (마스킹·보존)", () => {
  it.each(cases.map((c) => [c.name, c.input, c.expected] as const))("%s", (_name, input, expected) => {
    expect(maskSensitive(input)).toBe(expected);
  });
});

describe("maskDeep", () => {
  it("문자열 값만 마스킹하고 숫자·구조는 유지", () => {
    const doc = {
      overview: { summary: "주민번호 900101-1234567 확인", sourceTimestamp: { start: 1, end: 2 } },
      equipment: [{ name: "포스기", notes: "비밀번호 4829" }],
    };
    expect(maskDeep(doc)).toEqual({
      overview: { summary: "주민번호 [주민번호] 확인", sourceTimestamp: { start: 1, end: 2 } },
      equipment: [{ name: "포스기", notes: "비밀번호 4829" }],
    });
  });
});
