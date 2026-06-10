import type { HandoverDocument } from "./schema";
import type { ChecklistItem, EvalResult, JudgeOutput } from "./eval-schema";

// 채점 순수 로직 (LLM 비의존 — vitest 대상)
// 심판은 항목별 yes/no만 내고, 누락률·환각 집계는 여기서 결정적으로 계산

export interface DocumentClaim {
  index: number;
  section: string;
  text: string;
}

/** AI 문서를 환각 검사용 원자 주장 목록으로 평탄화 (8섹션 항목 단위) */
export function flattenDocumentClaims(doc: HandoverDocument): DocumentClaim[] {
  const claims: DocumentClaim[] = [];
  const add = (section: string, text: string) => {
    const t = text.trim();
    if (t) claims.push({ index: claims.length, section, text: t });
  };

  add("업무 개요", doc.overview.summary);
  if (doc.overview.cycle) add("업무 개요", `업무 주기: ${doc.overview.cycle}`);
  if (doc.overview.importance) {
    const label = { high: "높음", medium: "중간", low: "낮음" }[doc.overview.importance];
    add("업무 개요", `업무 중요도: ${label}`);
  }
  for (const p of doc.procedures) add("업무 절차", `${p.step}. ${p.title}: ${p.details}`);
  for (const a of doc.accounts)
    add("계정·접근 권한", [a.system, a.account, a.notes].filter(Boolean).join(" — "));
  for (const s of doc.stakeholders)
    add("관계자 맵", [`${s.name} (${s.role})`, s.relationship].filter(Boolean).join(" — "));
  for (const s of doc.schedules)
    add("일정·데드라인", [`${s.title}: ${s.when}`, s.details].filter(Boolean).join(" — "));
  for (const c of doc.cautions) add("주의사항·암묵지", c.content);
  for (const o of doc.openIssues) add("미해결 이슈", o.content);
  for (const f of doc.faq) add("FAQ", `Q: ${f.question} A: ${f.answer}`);

  return claims;
}

/** 심판 판정 → 최종 채점 결과 (결정적 계산). 판정 누락 시 throw — 조용히 넘기지 않음 */
export function applyJudgments(args: {
  checklist: ChecklistItem[];
  claims: DocumentClaim[];
  judge: JudgeOutput;
}): EvalResult {
  const factByIndex = new Map(args.judge.factJudgments.map((j) => [j.index, j]));
  const claimByIndex = new Map(args.judge.claimJudgments.map((j) => [j.index, j]));

  const missingFacts = args.checklist.map((_, i) => i).filter((i) => !factByIndex.has(i));
  const missingClaims = args.claims.map((c) => c.index).filter((i) => !claimByIndex.has(i));
  if (missingFacts.length > 0 || missingClaims.length > 0) {
    throw new Error(
      `심판이 일부 항목을 판정하지 않았습니다 (체크리스트: ${missingFacts.join(",") || "-"} / 주장: ${missingClaims.join(",") || "-"})`
    );
  }

  const missedItems = args.checklist
    .map((item, i) => ({ item, judgment: factByIndex.get(i)! }))
    .filter((x) => !x.judgment.present)
    .map((x) => ({ item: x.item.fact, section: x.item.section, critical: x.item.critical }));

  const hallucinations = args.claims
    .map((claim) => ({ claim, judgment: claimByIndex.get(claim.index)! }))
    .filter((x) => !x.judgment.supported)
    .map((x) => ({
      item: `[${x.claim.section}] ${x.claim.text}`,
      reason: x.judgment.evidence,
    }));

  return { goldenKeyItemCount: args.checklist.length, missedItems, hallucinations };
}
