import { describe, it, expect } from "vitest";
import { flattenDocumentClaims, applyJudgments } from "../lib/ai/eval-core";
import type { ChecklistItem, JudgeOutput } from "../lib/ai/eval-schema";
import type { HandoverDocument } from "../lib/ai/schema";

const base = { sourceTimestamp: null, confidence: "high" as const, inferred: false };

const doc: HandoverDocument = {
  overview: { summary: "편의점 야간 알바", cycle: "주 3회 야간", importance: "high", ...base },
  procedures: [
    { step: 1, title: "포스기 정산", details: "마감 버튼 후 시재 확인", ...base },
    { step: 2, title: "시재 보고", details: "정산표를 점장에게 카톡 전송", ...base, inferred: true },
  ],
  equipment: [{ name: "포스기", location: "카운터", notes: "관리자 비밀번호 *** (영상 3분)", ...base }],
  routines: [{ title: "유통기한 점검", when: "매일 자정", details: null, ...base }],
  contacts: [{ name: "김 점장", role: "점장", contact: "카톡", relationship: "마감 보고", ...base }],
  exceptions: [{ situation: "바코드 인식 불가", tip: "수기 입력 후 메모", ...base }],
  cautions: [{ content: "냉동고 문 꼭 닫기", ...base }],
  openItems: [{ content: "신규 발주 시스템 전환 진행 중", ...base }],
};

describe("flattenDocumentClaims", () => {
  it("v2 8섹션을 원자 주장으로 평탄화, index 연속", () => {
    const claims = flattenDocumentClaims(doc);
    expect(claims.map((c) => c.index)).toEqual([...claims.keys()]);
    expect(claims.map((c) => c.section)).toEqual([
      "업무 개요",
      "업무 개요",
      "업무 개요",
      "절차",
      "절차",
      "장비·위치·물품",
      "일정·루틴",
      "연락·보고",
      "예외 상황·꿀팁",
      "주의사항",
      "미해결·인계 항목",
    ]);
    expect(claims[1].text).toBe("업무 주기: 주 3회 야간");
    expect(claims[2].text).toBe("업무 중요도: 높음");
    expect(claims[3].text).toBe("1. 포스기 정산: 마감 버튼 후 시재 확인");
    expect(claims[5].text).toBe("포스기 — 위치: 카운터 — 관리자 비밀번호 *** (영상 3분)");
    expect(claims[7].text).toBe("김 점장 (점장) — 카톡 — 마감 보고");
    expect(claims[8].text).toBe("바코드 인식 불가 → 수기 입력 후 메모");
  });

  it("inferred 항목은 주장에 inferred=true로 전파", () => {
    const claims = flattenDocumentClaims(doc);
    expect(claims[4].inferred).toBe(true); // step 2 시재 보고
    expect(claims.filter((c) => c.inferred)).toHaveLength(1);
  });

  it("null 필드와 빈 섹션은 주장을 만들지 않는다", () => {
    const empty: HandoverDocument = {
      ...doc,
      overview: { summary: "요약", cycle: null, importance: null, ...base },
      procedures: [],
      equipment: [],
      routines: [],
      contacts: [],
      exceptions: [],
      cautions: [],
      openItems: [],
    };
    const claims = flattenDocumentClaims(empty);
    expect(claims).toHaveLength(1);
    expect(claims[0].text).toBe("요약");
  });
});

describe("applyJudgments", () => {
  const checklist: ChecklistItem[] = [
    { fact: "마감 보고는 김 점장에게", section: "연락·보고", critical: true },
    { fact: "유통기한 점검은 매일 자정", section: "일정·루틴", critical: false },
  ];
  const claims = [
    { index: 0, section: "업무 개요", text: "편의점 야간 알바", inferred: false },
    { index: 1, section: "절차", text: "구독자 100만 명 달성", inferred: false },
  ];

  it("present=false → 누락(critical 유지), supported=false → 환각", () => {
    const judge: JudgeOutput = {
      factJudgments: [
        { index: 0, present: true, evidence: "김 점장 (점장) — 마감 보고" },
        { index: 1, present: false, evidence: "" },
      ],
      claimJudgments: [
        { index: 0, supported: true, evidence: "트랜스크립트 00:10" },
        { index: 1, supported: false, evidence: "트랜스크립트에 구독자 언급 없음" },
      ],
    };
    const r = applyJudgments({ checklist, claims, judge });
    expect(r.goldenKeyItemCount).toBe(2);
    expect(r.missedItems).toEqual([
      { item: "유통기한 점검은 매일 자정", section: "일정·루틴", critical: false },
    ]);
    expect(r.hallucinations).toEqual([
      { item: "[절차] 구독자 100만 명 달성", reason: "트랜스크립트에 구독자 언급 없음" },
    ]);
  });

  it("inferred 주장은 근거 없어도 환각이 아니라 inferredClaims로 집계", () => {
    const inferredClaims = [
      { index: 0, section: "절차", text: "시재 확인 후 정산표 작성", inferred: true },
    ];
    const judge: JudgeOutput = {
      factJudgments: checklist.map((_, i) => ({ index: i, present: true, evidence: "e" })),
      claimJudgments: [{ index: 0, supported: false, evidence: "트랜스크립트에 없음" }],
    };
    const r = applyJudgments({ checklist, claims: inferredClaims, judge });
    expect(r.hallucinations).toHaveLength(0);
    expect(r.inferredClaims).toEqual(["[절차] 시재 확인 후 정산표 작성"]);
  });

  it("심판이 항목을 빠뜨리면 throw (조용히 누락 처리 금지)", () => {
    const judge: JudgeOutput = {
      factJudgments: [{ index: 0, present: true, evidence: "x" }], // index 1 누락
      claimJudgments: [
        { index: 0, supported: true, evidence: "" },
        { index: 1, supported: true, evidence: "" },
      ],
    };
    expect(() => applyJudgments({ checklist, claims, judge })).toThrow(/판정하지 않았/);
  });

  it("전부 통과하면 누락·환각 0", () => {
    const judge: JudgeOutput = {
      factJudgments: checklist.map((_, i) => ({ index: i, present: true, evidence: "e" })),
      claimJudgments: claims.map((c) => ({ index: c.index, supported: true, evidence: "e" })),
    };
    const r = applyJudgments({ checklist, claims, judge });
    expect(r.missedItems).toHaveLength(0);
    expect(r.hallucinations).toHaveLength(0);
  });
});
