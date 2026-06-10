import { describe, it, expect } from "vitest";
import { flattenDocumentClaims, applyJudgments } from "../lib/ai/eval-core";
import type { ChecklistItem, JudgeOutput } from "../lib/ai/eval-schema";
import type { HandoverDocument } from "../lib/ai/schema";

const base = { sourceTimestamp: null, confidence: "high" as const };

const doc: HandoverDocument = {
  overview: { summary: "유튜브 채널 운영", cycle: "매주", importance: "high", ...base },
  procedures: [{ step: 1, title: "기획", details: "월요일 회의에서 주제 선정", ...base }],
  accounts: [{ system: "노션", account: "team@x.com", notes: "비밀번호 *** (영상 3분)", ...base }],
  stakeholders: [{ name: "김 팀장", role: "팀장", relationship: "주간 보고", ...base }],
  schedules: [{ title: "월간 리포트", when: "매월 25일", details: null, ...base }],
  cautions: [{ content: "업로드 전 저작권 확인", ...base }],
  openIssues: [],
  faq: [{ question: "휴가 때는?", answer: "박 대리에게 위임", ...base }],
};

describe("flattenDocumentClaims", () => {
  it("8섹션을 원자 주장으로 평탄화, index 연속", () => {
    const claims = flattenDocumentClaims(doc);
    expect(claims.map((c) => c.index)).toEqual([...claims.keys()]);
    expect(claims.map((c) => c.section)).toEqual([
      "업무 개요",
      "업무 개요",
      "업무 개요",
      "업무 절차",
      "계정·접근 권한",
      "관계자 맵",
      "일정·데드라인",
      "주의사항·암묵지",
      "FAQ",
    ]);
    expect(claims[1].text).toBe("업무 주기: 매주");
    expect(claims[2].text).toBe("업무 중요도: 높음");
    expect(claims[3].text).toBe("1. 기획: 월요일 회의에서 주제 선정");
    expect(claims[8].text).toBe("Q: 휴가 때는? A: 박 대리에게 위임");
  });

  it("null 필드와 빈 섹션은 주장을 만들지 않는다", () => {
    const empty: HandoverDocument = {
      ...doc,
      overview: { summary: "요약", cycle: null, importance: null, ...base },
      procedures: [],
      accounts: [],
      stakeholders: [],
      schedules: [],
      cautions: [],
      openIssues: [],
      faq: [],
    };
    const claims = flattenDocumentClaims(empty);
    expect(claims).toHaveLength(1);
    expect(claims[0].text).toBe("요약");
  });
});

describe("applyJudgments", () => {
  const checklist: ChecklistItem[] = [
    { fact: "주간 보고는 김 팀장에게", section: "관계자 맵", critical: true },
    { fact: "월간 리포트는 매월 25일", section: "일정·데드라인", critical: false },
  ];
  const claims = [
    { index: 0, section: "업무 개요", text: "유튜브 채널 운영" },
    { index: 1, section: "FAQ", text: "구독자 100만 명" },
  ];

  it("present=false → 누락(critical 유지), supported=false → 환각", () => {
    const judge: JudgeOutput = {
      factJudgments: [
        { index: 0, present: true, evidence: "김 팀장 (팀장) — 주간 보고" },
        { index: 1, present: false, evidence: "" },
      ],
      claimJudgments: [
        { index: 0, supported: true, evidence: "트랜스크립트 00:10" },
        { index: 1, supported: false, evidence: "트랜스크립트에 구독자 수 언급 없음" },
      ],
    };
    const r = applyJudgments({ checklist, claims, judge });
    expect(r.goldenKeyItemCount).toBe(2);
    expect(r.missedItems).toEqual([
      { item: "월간 리포트는 매월 25일", section: "일정·데드라인", critical: false },
    ]);
    expect(r.hallucinations).toEqual([
      { item: "[FAQ] 구독자 100만 명", reason: "트랜스크립트에 구독자 수 언급 없음" },
    ]);
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
