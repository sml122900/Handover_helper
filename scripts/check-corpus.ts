// 가상 코퍼스 후처리·점검 (가상 데이터, API 호출 없음)
// 사용법: npx tsx scripts/check-corpus.ts
//  1) output/sN.{md,json} → data/virtual/ 로 옮기며 가상 데이터 표시 (md 머리말, json "virtual": true)
//  2) 사실 ID ↔ 트랜스크립트·문서 위치 매핑 → eval/fact-spans.json
//  3) 점검: 사실 매핑 누락, 의도적 공백 핵심어, 사실표에 없는 수치, schedules.json step_id
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  ALLOWED_NUMS,
  ALLOWED_TIMES,
  DERIVED,
  FACTS,
  GAP_KEYWORDS,
  GAP_PATTERNS,
  K,
  STORES,
  STORE_NAMES,
  type StoreId,
} from "./corpus-anchors";

const DIR = "data/virtual";
const BANNER = (id: StoreId) =>
  `> ⚠️ **가상 데이터** — ${STORE_NAMES[id]}. 실제 매장·인물과 무관한 테스트용 코퍼스입니다.\n\n`;

const SPEC_STEP_IDS: Record<StoreId, string[]> = {
  s1: ["s1.cake_waste", "s1.machine_clean", "s1.closing_settle", "s1.lights_off", "s1.security_arm", "s1.ice_machine_clean"],
  s2: ["s2.discount_sticker", "s2.waste_sort", "s2.oven_cooldown", "s2.lock_shutter", "s2.tray_wash", "s2.settle"],
  s3: ["s3.shift_cash_check", "s3.waste_check_00", "s3.waste_check_03", "s3.waste_check_06", "s3.drink_stock", "s3.cleaning", "s3.parcel_prep", "s3.work_log"],
  s4: ["s4.open_power", "s4.hvac", "s4.drink_fridge", "s4.towel_receive", "s4.lost_found"],
  s5: ["s5.safety_gear", "s5.meal_break", "s5.rest_break", "s5.scanner_return"],
};

// ---------- 1) 후처리 ----------
function finalize(id: StoreId): { md: string; txt: string } {
  const outMd = `output/${id}.md`;
  const outJson = `output/${id}.json`;
  const manual = existsSync(`${DIR}/${id}.md`) && readFileSync(`${DIR}/${id}.md`, "utf-8").includes("수동 정정");
  if (manual) console.log(`  (${id}: 수동 정정 파일 — output/ 으로 덮어쓰지 않음)`);
  if (!manual && existsSync(outMd)) {
    writeFileSync(`${DIR}/${id}.md`, BANNER(id) + readFileSync(outMd, "utf-8").replace(/\r\n/g, "\n"), "utf-8");
  }
  if (!manual && existsSync(outJson)) {
    const j = JSON.parse(readFileSync(outJson, "utf-8"));
    writeFileSync(`${DIR}/${id}.json`, JSON.stringify({ virtual: true, store_id: id, store_name: STORE_NAMES[id], ...j }, null, 2), "utf-8");
  }
  return {
    md: readFileSync(`${DIR}/${id}.md`, "utf-8"),
    txt: readFileSync(`${DIR}/${id}.txt`, "utf-8"),
  };
}

// ---------- 2) 위치 매핑 ----------
type Span = { start: number; end: number };

function allMatches(text: string, re: RegExp): Span[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out: Span[] = [];
  for (const m of text.matchAll(g)) out.push({ start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** 앵커들을 모두 포함하는 가장 좁은 구간. 매칭 안 된 앵커는 missing으로 반환 */
function findWindow(text: string, anchors: RegExp[]): { span: Span | null; missing: string[] } {
  const found = anchors.map((a) => ({ a, ms: allMatches(text, a) }));
  const missing = found.filter((f) => f.ms.length === 0).map((f) => f.a.source);
  const present = found.filter((f) => f.ms.length > 0);
  if (present.length === 0) return { span: null, missing };
  let best: Span | null = null;
  for (const pivot of present.flatMap((f) => f.ms)) {
    let s = pivot.start;
    let e = pivot.end;
    for (const f of present) {
      const nearest = f.ms.reduce((b, m) => (Math.abs(m.start - pivot.start) < Math.abs(b.start - pivot.start) ? m : b));
      s = Math.min(s, nearest.start);
      e = Math.max(e, nearest.end);
    }
    if (!best || e - s < best.end - best.start) best = { start: s, end: e };
  }
  return { span: best, missing };
}

const toSec = (mm: string, ss: string) => Number(mm) * 60 + Number(ss);

function transcriptTs(txt: string, pos: number): { start: number | null; end: number | null } {
  const tsRe = /^\[(\d{1,2}):(\d{2})\]/gm;
  const marks = [...txt.matchAll(tsRe)].map((m) => ({ at: m.index!, sec: toSec(m[1], m[2]) }));
  const i = marks.reduce((b, m, idx) => (m.at <= pos ? idx : b), -1);
  if (i < 0) return { start: null, end: null };
  return { start: marks[i].sec, end: marks[i + 1]?.sec ?? null };
}

function docTs(md: string, pos: number): { start: number | null; end: number | null } {
  const lineStart = md.lastIndexOf("\n", pos) + 1;
  const before = md.slice(0, md.indexOf("\n", pos) === -1 ? md.length : md.indexOf("\n", pos));
  const lines = before.slice(0, before.length).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/_\(영상 (\d+):(\d{2})~(\d+):(\d{2})\)_/);
    if (m) return { start: toSec(m[1], m[2]), end: toSec(m[3], m[4]) };
    if (lineStart < 0) break;
  }
  return { start: null, end: null };
}

// ---------- 3) 수치 점검 ----------
function normTime(h: string, m?: string): string {
  return `${Number(h) % 12}:${(m ?? "00").padStart(2, "0")}`;
}
const allowedTimeSet = (id: StoreId) =>
  new Set(ALLOWED_TIMES[id].map((t) => { const [h, m] = t.split(":"); return normTime(h, m); }));

function extractNumbers(text: string): { token: string; ctx: string }[] {
  let body = text
    .replace(/_\(영상[^)]*\)_/g, " ") // 영상 타임스탬프
    .replace(/^\s*\d+\.\s/gm, " ") // 절차 번호
    .replace(/^#.*$/gm, " "); // 제목
  const ctx = (i: number) => body.slice(Math.max(0, i - 15), i + 20).replace(/\n/g, " ");
  const out: { token: string; ctx: string }[] = [];
  // [mm:ss] 형태 타임스탬프(트랜스크립트)는 제외
  body = body.replace(/^\[\d{1,2}:\d{2}\]/gm, " ");
  const take = (re: RegExp, f: (m: RegExpMatchArray) => string) => {
    body = body.replace(re, (...args) => {
      const m = args.slice(0, args.length - 2) as unknown as RegExpMatchArray;
      const idx = args[args.length - 2] as number;
      out.push({ token: f(m), ctx: ctx(idx) });
      return " ";
    });
  };
  take(/(\d{1,2}):(\d{2})/g, (m) => normTime(m[1], m[2]));
  take(/(\d{1,2})시\s*(?:(\d{1,2})분)?(?!간)/g, (m) => normTime(m[1], m[2]));
  take(/(\d+)\s*만\s*원/g, (m) => `${Number(m[1]) * 10000}원`);
  take(/(\d[\d,]*)\s*(회(?!차)|시간|원|초|%|퍼센트|분|일|kg|킬로그램|킬로|개|번(?!과|째)|도|명|조|인|장|스푼)/g, (m) => {
    const u = m[2] === "퍼센트" ? "%" : m[2] === "킬로그램" || m[2] === "킬로" ? "kg" : m[2];
    return `${m[1].replace(/,/g, "")}${u}`;
  });
  return out;
}

// ---------- 실행 ----------
type Side = {
  file: string;
  char_start: number | null;
  char_end: number | null;
  video_ts: { start: number | null; end: number | null };
  reference_video_ts?: { start: number | null; end: number | null };
  spans?: { char_start: number; char_end: number; video_ts: { start: number | null; end: number | null } }[];
  status: "full" | "partial" | "missing";
  missing_anchors: string[];
  preview: string | null;
};

function locate(file: string, text: string, anchors: RegExp[], isDoc: boolean): Side {
  const { span, missing } = findWindow(text, anchors);
  if (!span) {
    return { file, char_start: null, char_end: null, video_ts: { start: null, end: null }, ...(isDoc ? { reference_video_ts: { start: null, end: null } } : {}), status: "missing", missing_anchors: missing, preview: null };
  }
  return {
    file,
    char_start: span.start,
    char_end: span.end,
    video_ts: isDoc ? { start: null, end: null } : transcriptTs(text, span.start),
    ...(isDoc ? { reference_video_ts: docTs(text, span.start) } : {}),
    status: missing.length === 0 ? "full" : "partial",
    missing_anchors: missing,
    preview: text.slice(span.start, Math.min(span.end, span.start + 80)).replace(/\n/g, " "),
  };
}

function paragraphs(txt: string): { start: number; end: number }[] {
  const marks = [...txt.matchAll(/^\[\d{1,2}:\d{2}\]/gm)].map((m) => m.index!);
  return marks.map((s, i) => ({ start: s, end: marks[i + 1] ?? txt.length }));
}
let tsMismatch = 0;
const tsMismatchList: string[] = [];
const spans: Record<string, unknown> = {};
const report: string[] = [];
let problems = 0;
const flag = (s: string) => {
  problems++;
  report.push(`  ✗ ${s}`);
};

for (const id of STORES) {
  const { md, txt } = finalize(id);
  report.push(`\n## ${id} ${STORE_NAMES[id]}  (트랜스크립트 ${txt.length}자, 문서 ${md.length}자)`);

  // 사실 매핑
  for (const [fid, a] of Object.entries(FACTS[id])) {
    const t = locate(`${DIR}/${id}.txt`, txt, a.t, false);
    const d = locate(`${DIR}/${id}.md`, md, a.d, true);
    // 재언급 포함 전체 정답 구간: k 표현이 전부 들어 있는 문단 + 주 구간이 속한 문단
    const ps = paragraphs(txt).filter((p) => {
      const chunk = txt.slice(p.start, p.end);
      const hit = (K[fid] ?? []).every((re) => re.test(chunk));
      const primary = t.char_start !== null && t.char_start >= p.start && t.char_start < p.end;
      return hit || primary;
    });
    t.spans = ps.map((p) => ({ char_start: p.start, char_end: p.end, video_ts: transcriptTs(txt, p.start) }));
    // 문서 참고 타임스탬프가 어느 트랜스크립트 정답 문단과도 ±5초 내 겹치지 않으면 어긋남
    const rd = d.reference_video_ts;
    const okTs =
      rd?.start != null &&
      t.spans.some((sp) => {
        const a = sp.video_ts.start ?? 0;
        const b = sp.video_ts.end ?? a + 60;
        return rd.start! <= b + 5 && (rd.end ?? rd.start!) >= a - 5;
      });
    if (!okTs) {
      tsMismatch++;
      tsMismatchList.push(fid);
    }
    spans[fid] = { store_id: id, video_ts: t.video_ts, transcript: t, document: d };
    if (t.status !== "full") flag(`${fid} 트랜스크립트 ${t.status}: ${t.missing_anchors.join(" | ")}`);
    if (d.status !== "full") flag(`${fid} 문서 ${d.status}: ${d.missing_anchors.join(" | ")}`);
  }

  // 의도적 공백
  const gapHits: string[] = [];
  for (const [label, text] of [["트랜스크립트", txt], ["문서", md]] as const) {
    for (const k of GAP_KEYWORDS[id]) {
      const i = text.toLowerCase().indexOf(k.toLowerCase());
      if (i >= 0) gapHits.push(`${label}에 "${k}": …${text.slice(Math.max(0, i - 25), i + 30).replace(/\n/g, " ")}…`);
    }
    for (const re of GAP_PATTERNS[id] ?? []) {
      const m = text.match(re);
      if (m) gapHits.push(`${label}에 패턴 ${re}: …${m[0]}…`);
    }
  }
  for (const h of gapHits) flag(`[공백 침범] ${h}`);

  // 새 수치
  const okT = allowedTimeSet(id);
  const okN = new Set(ALLOWED_NUMS[id]);
  const dT = new Set(DERIVED[id].times.map((t) => { const [h, m] = t.split(":"); return normTime(h, m); }));
  const dN = new Set(DERIVED[id].nums);
  const numRe = /\d/;
  for (const [label, text] of [["트랜스크립트", txt], ["문서", md.replace(/^> .*$/gm, "")]] as const) {
    for (const { token, ctx } of extractNumbers(text)) {
      const isTime = /^\d+:\d{2}$/.test(token);
      if (!numRe.test(token)) continue;
      if (isTime ? dT.has(token) : dN.has(token)) {
        report.push(`  ~ [도출 수치, 허용] ${label} "${token}" — ${DERIVED[id].why}`);
        continue;
      }
      if (isTime ? !okT.has(token) : !okN.has(token)) flag(`[새 수치] ${label} "${token}": …${ctx}…`);
    }
  }
}

// schedules.json step_id 대조
const sched = JSON.parse(readFileSync(`${DIR}/schedules.json`, "utf-8")) as {
  stores: { store_id: StoreId; items: { step_ids: string[] }[] }[];
};
report.push("\n## schedules.json step_id");
for (const s of sched.stores) {
  const have = new Set(s.items.flatMap((i) => i.step_ids));
  const want = new Set(SPEC_STEP_IDS[s.store_id]);
  for (const w of want) if (!have.has(w)) flag(`schedules ${s.store_id}: step_id 누락 ${w}`);
  for (const h of have) if (!want.has(h)) flag(`schedules ${s.store_id}: 사양에 없는 step_id ${h}`);
}

mkdirSync("eval", { recursive: true });
writeFileSync(
  "eval/fact-spans.json",
  JSON.stringify(
    {
      virtual: true,
      _note:
        "가상 데이터. 사실 ID(corpus-spec.md) → 트랜스크립트(.txt)·문서(.md) 원문 위치. char_start/char_end는 UTF-16 코드 단위(LF 줄바꿈 기준), video_ts(정답 위치의 영상 시각, 초)는 트랜스크립트 기준이며 문서의 ts는 document.reference_video_ts에 참고값으로만 보관. transcript.spans는 재언급 포함 전체 정답 문단. 문서의 위치는 가상 데이터 머리말을 포함한 .md 파일 기준. status=partial/missing이면 문서에서 사실(일부)이 빠진 것.",
      facts: spans,
    },
    null,
    2
  ),
  "utf-8"
);

report.push(`
## 문서 참고 타임스탬프 어긋남: ${tsMismatch}/${Object.keys(spans).length}  [${tsMismatchList.join(", ")}]`);
console.log(report.join("\n"));
console.log(`\n사실 ${Object.keys(spans).length}개 · 문제 ${problems}건 → eval/fact-spans.json`);
process.exitCode = problems > 0 ? 1 : 0;
