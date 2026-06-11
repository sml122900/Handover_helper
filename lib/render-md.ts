import type { HandoverDocument } from "./ai/schema";

// 구조화 문서 → 사람이 읽기 좋은 마크다운 (스키마 v2)

function ts(t: { start: number; end: number } | null): string {
  if (!t) return "";
  return ` _(영상 ${fmt(t.start)}~${fmt(t.end)})_`;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function flag(meta: { confidence: "high" | "needs_review"; inferred?: boolean }): string {
  if (meta.inferred) return " 🤖 [AI 보완 — 작성자 확인 필요]";
  return meta.confidence === "needs_review" ? " ⚠️ [확인 필요]" : "";
}

export function renderMarkdown(doc: HandoverDocument, title: string): string {
  const lines: string[] = [`# 인수인계 문서: ${title}`, ""];

  lines.push("## 1. 업무 개요", "");
  lines.push(`- **요약**: ${doc.overview.summary}${flag(doc.overview)}${ts(doc.overview.sourceTimestamp)}`);
  if (doc.overview.cycle) lines.push(`- **주기**: ${doc.overview.cycle}`);
  if (doc.overview.importance) lines.push(`- **중요도**: ${doc.overview.importance}`);
  lines.push("");

  lines.push("## 2. 절차", "");
  if (doc.procedures.length === 0) lines.push("_내용 없음_");
  for (const p of doc.procedures) {
    lines.push(`${p.step}. **${p.title}**${flag(p)}${ts(p.sourceTimestamp)}`);
    lines.push(`   ${p.details}`);
  }
  lines.push("");

  lines.push("## 3. 장비·위치·물품", "");
  if (doc.equipment.length === 0) lines.push("_내용 없음_");
  for (const e of doc.equipment) {
    lines.push(`- **${e.name}**${e.location ? ` — 위치: ${e.location}` : ""}${flag(e)}${ts(e.sourceTimestamp)}`);
    if (e.notes) lines.push(`  - ${e.notes}`);
  }
  lines.push("");

  lines.push("## 4. 일정·루틴", "");
  if (doc.routines.length === 0) lines.push("_내용 없음_");
  for (const r of doc.routines) {
    lines.push(`- **${r.when}** — ${r.title}${flag(r)}${ts(r.sourceTimestamp)}`);
    if (r.details) lines.push(`  - ${r.details}`);
  }
  lines.push("");

  lines.push("## 5. 연락·보고", "");
  if (doc.contacts.length === 0) lines.push("_내용 없음_");
  for (const c of doc.contacts) {
    lines.push(
      `- **${c.name}** (${c.role})${c.contact ? ` — ${c.contact}` : ""}${c.relationship ? ` — ${c.relationship}` : ""}${flag(c)}${ts(c.sourceTimestamp)}`
    );
  }
  lines.push("");

  lines.push("## 6. 예외 상황·꿀팁", "");
  if (doc.exceptions.length === 0) lines.push("_내용 없음_");
  for (const x of doc.exceptions) {
    lines.push(`- **${x.situation}** → ${x.tip}${flag(x)}${ts(x.sourceTimestamp)}`);
  }
  lines.push("");

  lines.push("## 7. 주의사항", "");
  if (doc.cautions.length === 0) lines.push("_내용 없음_");
  for (const c of doc.cautions) {
    lines.push(`- ${c.content}${flag(c)}${ts(c.sourceTimestamp)}`);
  }
  lines.push("");

  lines.push("## 8. 미해결·인계 항목", "");
  if (doc.openItems.length === 0) lines.push("_내용 없음_");
  for (const i of doc.openItems) {
    lines.push(`- ${i.content}${flag(i)}${ts(i.sourceTimestamp)}`);
  }
  lines.push("");

  return lines.join("\n");
}
