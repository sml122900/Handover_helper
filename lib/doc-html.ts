import type { HandoverDocument } from "./ai/schema";

// 구조화 문서(JSON) → 에디터 초기 HTML (8섹션 구조 유지, 스키마 v2)
// needs_review 항목은 <mark>로 감싸 Tiptap Highlight로 노란 하이라이트
// inferred(AI 보완) 항목은 <mark>[AI 보완] …</mark> — 작성자가 확인 후 mark 해제/수정

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
  meta: { confidence: "high" | "needs_review"; inferred?: boolean },
  ts: { start: number; end: number } | null
): string {
  const suffix = ts ? ` <em>(영상 ${fmt(ts.start)}~${fmt(ts.end)})</em>` : "";
  let body = text;
  if (meta.inferred) {
    // code 마크 = 에디터에서 초록 pill 스타일 ([AI 보완] 라벨 전용 — strong은 절차 제목과 충돌)
    body = `<mark><code>[AI 보완]</code> ${text} — 작성자 확인 필요</mark>`;
  } else if (meta.confidence === "needs_review") {
    body = `<mark>${text} [확인 필요]</mark>`;
  }
  return `<li>${body}${suffix}</li>`;
}

export function documentToHtml(doc: HandoverDocument): string {
  const parts: string[] = [];

  parts.push("<h2>1. 업무 개요</h2><ul>");
  parts.push(
    item(
      `<strong>요약:</strong> ${esc(doc.overview.summary)}`,
      doc.overview,
      doc.overview.sourceTimestamp
    )
  );
  if (doc.overview.cycle) parts.push(`<li><strong>주기:</strong> ${esc(doc.overview.cycle)}</li>`);
  if (doc.overview.importance)
    parts.push(`<li><strong>중요도:</strong> ${esc(doc.overview.importance)}</li>`);
  parts.push("</ul>");

  parts.push("<h2>2. 절차</h2>");
  parts.push(doc.procedures.length === 0 ? "<p>내용 없음</p>" : "<ol>");
  for (const p of doc.procedures) {
    parts.push(
      item(`<strong>${esc(p.title)}</strong> — ${esc(p.details)}`, p, p.sourceTimestamp)
    );
  }
  if (doc.procedures.length > 0) parts.push("</ol>");

  parts.push("<h2>3. 장비·위치·물품</h2>");
  parts.push(doc.equipment.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const e of doc.equipment) {
    const text = `<strong>${esc(e.name)}</strong>${e.location ? ` — 위치: ${esc(e.location)}` : ""}${e.notes ? ` · ${esc(e.notes)}` : ""}`;
    parts.push(item(text, e, e.sourceTimestamp));
  }
  if (doc.equipment.length > 0) parts.push("</ul>");

  parts.push("<h2>4. 일정·루틴</h2>");
  parts.push(doc.routines.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const r of doc.routines) {
    const text = `<strong>${esc(r.when)}</strong> — ${esc(r.title)}${r.details ? ` · ${esc(r.details)}` : ""}`;
    parts.push(item(text, r, r.sourceTimestamp));
  }
  if (doc.routines.length > 0) parts.push("</ul>");

  parts.push("<h2>5. 연락·보고</h2>");
  parts.push(doc.contacts.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const c of doc.contacts) {
    const text = `<strong>${esc(c.name)}</strong> (${esc(c.role)})${c.contact ? ` — ${esc(c.contact)}` : ""}${c.relationship ? ` — ${esc(c.relationship)}` : ""}`;
    parts.push(item(text, c, c.sourceTimestamp));
  }
  if (doc.contacts.length > 0) parts.push("</ul>");

  parts.push("<h2>6. 예외 상황·꿀팁</h2>");
  parts.push(doc.exceptions.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const x of doc.exceptions) {
    parts.push(
      item(`<strong>${esc(x.situation)}</strong> → ${esc(x.tip)}`, x, x.sourceTimestamp)
    );
  }
  if (doc.exceptions.length > 0) parts.push("</ul>");

  parts.push("<h2>7. 주의사항</h2>");
  parts.push(doc.cautions.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const c of doc.cautions) parts.push(item(esc(c.content), c, c.sourceTimestamp));
  if (doc.cautions.length > 0) parts.push("</ul>");

  parts.push("<h2>8. 미해결·인계 항목</h2>");
  parts.push(doc.openItems.length === 0 ? "<p>내용 없음</p>" : "<ul>");
  for (const i of doc.openItems) parts.push(item(esc(i.content), i, i.sourceTimestamp));
  if (doc.openItems.length > 0) parts.push("</ul>");

  return parts.join("");
}

export const SECTION_NAMES = [
  "업무 개요",
  "절차",
  "장비·위치·물품",
  "일정·루틴",
  "연락·보고",
  "예외 상황·꿀팁",
  "주의사항",
  "미해결·인계 항목",
] as const;
