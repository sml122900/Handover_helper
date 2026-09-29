import { describe, it, expect } from "vitest";
import { estimateBytes, evaluateRecording, shouldGuardUnload } from "../lib/recording-limits";
import { MAX_UPLOAD_BYTES } from "../lib/upload-validate";

describe("estimateBytes", () => {
  it("Free 최대 20분·30분 녹화가 500MB 안 (목표 비트레이트 기준)", () => {
    expect(estimateBytes(20 * 60)).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(estimateBytes(30 * 60)).toBeLessThan(MAX_UPLOAD_BYTES);
  });
  it("30분 ≤ 한도의 80% (오버슈트 여유)", () => {
    expect(estimateBytes(30 * 60)).toBeLessThan(MAX_UPLOAD_BYTES * 0.8);
  });
  it("0초 = 0", () => expect(estimateBytes(0)).toBe(0));
});

describe("evaluateRecording", () => {
  const L = 1000;
  it.each([
    [0, "ok"],
    [799, "ok"],
    [800, "warn"], // 80% 경계
    [949, "warn"],
    [950, "stop"], // 95% 경계
    [2000, "stop"],
  ])("누적 %i / 한도 1000 → %s", (bytes, level) => {
    expect(evaluateRecording(bytes, L)).toBe(level);
  });
  it("기본 한도는 500MB", () => {
    expect(evaluateRecording(MAX_UPLOAD_BYTES * 0.5)).toBe("ok");
    expect(evaluateRecording(MAX_UPLOAD_BYTES * 0.85)).toBe("warn");
    expect(evaluateRecording(MAX_UPLOAD_BYTES * 0.96)).toBe("stop");
  });
});

describe("shouldGuardUnload", () => {
  it.each([
    ["recording", false, true],
    ["paused", false, true],
    ["uploading", false, true],
    ["idle", true, true], // 업로드 실패 후 보존 중
    ["idle", false, false],
  ] as const)("phase=%s 보존=%s → %s", (phase, saved, expected) => {
    expect(shouldGuardUnload(phase, saved)).toBe(expected);
  });
});
