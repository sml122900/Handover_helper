import { describe, it, expect } from "vitest";
import {
  aggregateMissesBySection,
  renderCompareTable,
  summarizeByVersion,
  type SampleEvalRow,
} from "../lib/ai/compare-report";
import type { EvalResult } from "../lib/ai/eval-schema";

function evalResult(over: Partial<EvalResult>): EvalResult {
  return {
    goldenKeyItemCount: 10,
    missedItems: [],
    hallucinations: [],
    sectionScores: [],
    overallComment: "",
    ...over,
  };
}

const rows: SampleEvalRow[] = [
  {
    name: "a",
    version: "structure-v1",
    result: evalResult({
      missedItems: [
        { item: "노션 링크", section: "업무 절차" },
        { item: "보고 주기", section: "관계자 맵" },
      ],
      hallucinations: [{ item: "x", reason: "근거 없음" }],
    }),
  },
  {
    name: "b",
    version: "structure-v1",
    result: evalResult({
      goldenKeyItemCount: 20,
      missedItems: [{ item: "마감일", section: "업무 절차" }],
    }),
  },
  { name: "a", version: "structure-v2", result: evalResult({}) },
  { name: "b", version: "structure-v2", result: evalResult({ goldenKeyItemCount: 20 }) },
];

describe("aggregateMissesBySection", () => {
  it("섹션별 카운트 내림차순, 항목에 샘플명 표기", () => {
    const agg = aggregateMissesBySection(
      rows.filter((r) => r.version === "structure-v1").map((r) => ({ name: r.name, result: r.result }))
    );
    expect(agg[0]).toMatchObject({ section: "업무 절차", count: 2 });
    expect(agg[0].items).toEqual(["[a] 노션 링크", "[b] 마감일"]);
    expect(agg[1]).toMatchObject({ section: "관계자 맵", count: 1 });
  });

  it("빈 섹션명은 (섹션 미상)으로", () => {
    const agg = aggregateMissesBySection([
      { name: "x", result: evalResult({ missedItems: [{ item: "i", section: " " }] }) },
    ]);
    expect(agg[0].section).toBe("(섹션 미상)");
  });
});

describe("summarizeByVersion", () => {
  it("버전별 누락률 = Σ누락/Σ핵심정보", () => {
    const s = summarizeByVersion(rows);
    const v1 = s.find((x) => x.version === "structure-v1")!;
    expect(v1.missed).toBe(3);
    expect(v1.keyItems).toBe(30);
    expect(v1.missRate).toBeCloseTo(0.1);
    expect(v1.hallucinations).toBe(1);
    const v2 = s.find((x) => x.version === "structure-v2")!;
    expect(v2.missRate).toBe(0);
  });
});

describe("renderCompareTable", () => {
  it("샘플 행 + 합계 행, 버전당 누락률·환각 열", () => {
    const md = renderCompareTable(rows, ["structure-v1", "structure-v2"]);
    expect(md).toContain("| a |");
    expect(md).toContain("20.0% (2/10)");
    expect(md).toContain("**10.0%** (3/30)");
    expect(md).toContain("**0.0%** (0/30)");
    expect(md).toContain("| **합계** |");
  });

  it("누락 결과 없는 셀은 (없음) 표시", () => {
    const md = renderCompareTable(rows.slice(0, 1), ["structure-v1", "structure-v2"]);
    expect(md).toContain("(없음)");
  });
});
