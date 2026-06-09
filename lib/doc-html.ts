import type { HandoverDocument } from "./ai/schema";

// 구조화 문서(JSON) → 에디터 초기 HTML (8섹션 구조 유지)
// needs_review 항목은 <mark>로 감싸 Tiptap Highlight로 노란 하이라이트

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function item(
  text: string,
  confidence: "high" | "needs_review",
  ts: { start: number; end: number } | null
): string {
  const suffix = ts ? ` <em>(영상 ${fmt(ts.start)}~${fmt(ts.end)})</em>` : "";
  const body = confidence === "needs_review" ? `<mark>${text} [확인 필요]</mark>` : text;
  return `<li>${body}${suffix}</li>`;
}

export function documentToHtml(doc: HandoverDocument): string {
  const parts: string[] = [];

  parts.push("<h2>1. 업무 개요</h2><ul>");
  parts.push(
    item(
      `<strong>요약:</strong> ${esc(doc.overview.summary)}`,
      doc.overview.confidence,
      doc.overview.sourceTimestamp
    )
  );
  if (doc.overview.cycle) parts.push(`<li><strong>주기:</strong> ${esc(doc.overview.cycle)}</li>`);
  if (doc.overview.importance)
    parts.push(`<li><strong>중요도:</strong> ${esc(doc.overview.importance)}</li>`);
  parts.push("</ul>");

  parts.push("<h2>2. 업무 절차</h2>");
  parts.push(doc.procedures.length === 0 ? "<p>내용 없음</p>" : "<ol>");
  for (const p of doc.procedures) {
    parts.push(
      item(
        `<strong>${esc(p.title)}</strong> — ${esc(p.details)}`,
        p.confidence,
        p.sourceTimestamp
      )
    );
  }
  if (doc.procedures.length > 0) parts.push("</ol>");

  parts.push("<h2>3. 계정·접근 권한</h2>");
  parts.push(doc.accounts.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const a of doc.accounts) {
    const text = `<strong>${esc(a.system)}</strong>${a.account ? ` — 계정: ${esc(a.account)}` : ""}${a.notes ? ` · ${esc(a.notes)}` : ""}`;
    parts.push(item(text, a.confidence, a.sourceTimestamp));
  }
  if (doc.accounts.length > 0) parts.push("</ul>");

  parts.push("<h2>4. 관계자 맵</h2>");
  parts.push(doc.stakeholders.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const s of doc.stakeholders) {
    const text = `<strong>${esc(s.name)}</strong> (${esc(s.role)})${s.relationship ? ` — ${esc(s.relationship)}` : ""}`;
    parts.push(item(text, s.confidence, s.sourceTimestamp));
  }
  if (doc.stakeholders.length > 0) parts.push("</ul>");

  parts.push("<h2>5. 일정·데드라인</h2>");
  parts.push(doc.schedules.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const s of doc.schedules) {
    const text = `<strong>${esc(s.when)}</strong> — ${esc(s.title)}${s.details ? ` · ${esc(s.details)}` : ""}`;
    parts.push(item(text, s.confidence, s.sourceTimestamp));
  }
  if (doc.schedules.length > 0) parts.push("</ul>");

  parts.push("<h2>6. 주의사항·암묵지</h2>");
  parts.push(doc.cautions.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const c of doc.cautions) parts.push(item(esc(c.content), c.confidence, c.sourceTimestamp));
  if (doc.cautions.length > 0) parts.push("</ul>");

  parts.push("<h2>7. 미해결 이슈</h2>");
  parts.push(doc.openIssues.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const i of doc.openIssues) parts.push(item(esc(i.content), i.confidence, i.sourceTimestamp));
  if (doc.openIssues.length > 0) parts.push("</ul>");

  parts.push("<h2>8. FAQ</h2>");
  parts.push(doc.faq.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const f of doc.faq) {
    parts.push(
      item(`<strong>Q. ${esc(f.question)}</strong> — A. ${esc(f.answer)}`, f.confidence, f.sourceTimestamp)
    );
  }
  if (doc.faq.length > 0) parts.push("</ul>");

  return parts.join("");
}

export const SECTION_NAMES = [
  "업무 개요",
  "업무 절차",
  "계정·접근 권한",
  "관계자 맵",
  "일정·데드라인",
  "주의사항·암묵지",
  "미해결 이슈",
  "FAQ",
] as const;
