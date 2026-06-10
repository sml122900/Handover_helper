import type { EvalResult } from "./eval-schema";

// 비교·집계 리포트 순수 로직 (compare-prompts.ts / report-misses.ts 공용, vitest 대상)

export interface SampleEvalRow {
  name: string; // 샘플 이름
  version: string; // 프롬프트 버전
  result: EvalResult;
}

export interface SectionMiss {
  section: string;
  count: number;
  items: string[]; // "[샘플명] 누락 항목" 형식
}

/** 누락 항목을 섹션별로 집계 (반복 누락 섹션 = 프롬프트 개선 타깃) */
export function aggregateMissesBySection(
  evals: { name: string; result: EvalResult }[]
): SectionMiss[] {
  const map = new Map<string, SectionMiss>();
  for (const e of evals) {
    for (const m of e.result.missedItems) {
      const section = m.section.trim() || "(섹션 미상)";
      const entry = map.get(section) ?? { section, count: 0, items: [] };
      entry.count++;
      entry.items.push(`[${e.name}] ${m.critical ? "⚠ " : ""}${m.item}`);
      map.set(section, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function renderSectionMissReport(misses: SectionMiss[], title: string): string {
  const lines = [`## ${title}`, ""];
  if (misses.length === 0) {
    lines.push("_누락 없음_", "");
    return lines.join("\n");
  }
  lines.push("| 섹션 | 누락 수 |", "| --- | --- |");
  for (const m of misses) lines.push(`| ${m.section} | ${m.count} |`);
  lines.push("");
  for (const m of misses) {
    lines.push(`### ${m.section} (${m.count}건)`, "");
    for (const item of m.items) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** 버전별 합산: 누락률 = Σ누락 / Σ핵심정보, 환각 = Σ건수 */
export function summarizeByVersion(
  rows: SampleEvalRow[]
): { version: string; missed: number; keyItems: number; hallucinations: number; missRate: number }[] {
  const map = new Map<string, { missed: number; keyItems: number; hallucinations: number }>();
  for (const r of rows) {
    const s = map.get(r.version) ?? { missed: 0, keyItems: 0, hallucinations: 0 };
    s.missed += r.result.missedItems.length;
    s.keyItems += r.result.goldenKeyItemCount;
    s.hallucinations += r.result.hallucinations.length;
    map.set(r.version, s);
  }
  return [...map.entries()].map(([version, s]) => ({
    version,
    ...s,
    missRate: s.keyItems === 0 ? 0 : s.missed / s.keyItems,
  }));
}

/** 샘플 × 버전 비교표 (markdown) */
export function renderCompareTable(rows: SampleEvalRow[], versions: string[]): string {
  const pct = (missed: number, total: number) =>
    total === 0 ? "-" : `${((missed / total) * 100).toFixed(1)}%`;

  const header = ["| 샘플 |", ...versions.map((v) => ` ${v} 누락률 | ${v} 환각 |`)].join("");
  const divider = ["| --- |", ...versions.map(() => " --- | --- |")].join("");
  const lines = [header, divider];

  const names = [...new Set(rows.map((r) => r.name))];
  for (const name of names) {
    const cells = versions.map((v) => {
      const r = rows.find((x) => x.name === name && x.version === v);
      if (!r) return " (없음) | (없음) |";
      const miss = pct(r.result.missedItems.length, r.result.goldenKeyItemCount);
      return ` ${miss} (${r.result.missedItems.length}/${r.result.goldenKeyItemCount}) | ${r.result.hallucinations.length}건 |`;
    });
    lines.push([`| ${name} |`, ...cells].join(""));
  }

  const totals = summarizeByVersion(rows);
  const totalCells = versions.map((v) => {
    const t = totals.find((x) => x.version === v);
    if (!t) return " - | - |";
    return ` **${(t.missRate * 100).toFixed(1)}%** (${t.missed}/${t.keyItems}) | **${t.hallucinations}건** |`;
  });
  lines.push([`| **합계** |`, ...totalCells].join(""));
  return lines.join("\n");
}
