import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "../lib/format-date";

describe("format-date (TZ=UTC 서버에서도 KST 표시)", () => {
  it("테스트 환경이 UTC로 고정됨", () => {
    expect(new Date("2026-09-30T00:00:00Z").getHours()).toBe(0);
  });

  it("UTC 15:30 → KST 다음날 00:30 (날짜가 넘어감)", () => {
    expect(formatDate("2026-09-29T15:30:00Z")).toBe("2026. 9. 30.");
    expect(formatDateTime("2026-09-29T15:30:00Z")).toBe("2026. 9. 30. 00:30");
  });

  it("UTC 06:05 → KST 15:05 (9시간 차)", () => {
    expect(formatDateTime("2026-09-30T06:05:09Z")).toBe("2026. 9. 30. 15:05");
  });

  it("Date·epoch ms 입력도 동일", () => {
    const iso = "2026-01-01T14:59:59Z"; // KST 23:59:59 (같은 날)
    expect(formatDate(new Date(iso))).toBe("2026. 1. 1.");
    expect(formatDate(Date.parse(iso))).toBe("2026. 1. 1.");
    expect(formatDate("2026-01-01T15:00:00Z")).toBe("2026. 1. 2.");
  });
});
