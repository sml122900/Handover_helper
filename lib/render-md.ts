import type { HandoverDocument } from "./ai/schema.js";

// 구조화 문서 → 사람이 읽기 좋은 마크다운

function ts(t: { start: number; end: number } | null): string {
  if (!t) return "";
  return ` _(영상 ${fmt(t.start)}~${fmt(t.end)})_`;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function flag(confidence: "high" | "needs_review"): string {
  return confidence === "needs_review" ? " ⚠️ [확인 필요]" : "";
}

export function renderMarkdown(doc: HandoverDocument, title: string): string {
  const lines: string[] = [`# 인수인계 문서: ${title}`, ""];

  lines.push("## 1. 업무 개요", "");
  lines.push(`- **요약**: ${doc.overview.summary}${flag(doc.overview.confidence)}${ts(doc.overview.sourceTimestamp)}`);
  if (doc.overview.cycle) lines.push(`- **주기**: ${doc.overview.cycle}`);
  if (doc.overview.importance) lines.push(`- **중요도**: ${doc.overview.importance}`);
  lines.push("");

  lines.push("## 2. 업무 절차", "");
  if (doc.procedures.length === 0) lines.push("_내용 없음_");
  for (const p of doc.procedures) {
    lines.push(`${p.step}. **${p.title}**${flag(p.confidence)}${ts(p.sourceTimestamp)}`);
    lines.push(`   ${p.details}`);
  }
  lines.push("");

  lines.push("## 3. 계정·접근 권한", "");
  if (doc.accounts.length === 0) lines.push("_내용 없음_");
  for (const a of doc.accounts) {
    lines.push(`- **${a.system}**${a.account ? ` — 계정: ${a.account}` : ""}${flag(a.confidence)}${ts(a.sourceTimestamp)}`);
    if (a.notes) lines.push(`  - ${a.notes}`);
  }
  lines.push("");

  lines.push("## 4. 관계자 맵", "");
  if (doc.stakeholders.length === 0) lines.push("_내용 없음_");
  for (const s of doc.stakeholders) {
    lines.push(`- **${s.name}** (${s.role})${s.relationship ? ` — ${s.relationship}` : ""}${flag(s.confidence)}${ts(s.sourceTimestamp)}`);
  }
  lines.push("");

  lines.push("## 5. 일정·데드라인", "");
  if (doc.schedules.length === 0) lines.push("_내용 없음_");
  for (const s of doc.schedules) {
    lines.push(`- **${s.when}** — ${s.title}${flag(s.confidence)}${ts(s.sourceTimestamp)}`);
    if (s.details) lines.push(`  - ${s.details}`);
  }
  lines.push("");

  lines.push("## 6. 주의사항·암묵지", "");
  if (doc.cautions.length === 0) lines.push("_내용 없음_");
  for (const c of doc.cautions) {
    lines.push(`- ${c.content}${flag(c.confidence)}${ts(c.sourceTimestamp)}`);
  }
  lines.push("");

  lines.push("## 7. 미해결 이슈", "");
  if (doc.openIssues.length === 0) lines.push("_내용 없음_");
  for (const i of doc.openIssues) {
    lines.push(`- ${i.content}${flag(i.confidence)}${ts(i.sourceTimestamp)}`);
  }
  lines.push("");

  lines.push("## 8. FAQ", "");
  if (doc.faq.length === 0) lines.push("_내용 없음_");
  for (const f of doc.faq) {
    lines.push(`- **Q. ${f.question}**${flag(f.confidence)}${ts(f.sourceTimestamp)}`);
    lines.push(`  - A. ${f.answer}`);
  }
  lines.push("");

  return lines.join("\n");
}
