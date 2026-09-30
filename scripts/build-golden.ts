// eval/golden-draft.md → eval/golden.jsonl 변환 + 검증 (API 호출 없음). 골든셋 내용은 고치지 않고 문제만 출력
import { readFileSync, writeFileSync } from "node:fs";

const spans = JSON.parse(readFileSync("eval/fact-spans.json", "utf8")).facts as Record<string, unknown>;
const sched = JSON.parse(readFileSync("data/virtual/schedules.json", "utf8")).stores as {
  store_id: string;
  items: { time: string | null; step_ids: string[] }[];
}[];
const spec = readFileSync("data/virtual/corpus-spec.md", "utf8");
const avoid = readFileSync("eval/avoid-terms.md", "utf8");

const STORE: Record<string, string> = { C: "S1", B: "S2", M: "S3", G: "S4", L: "S5" };
const ids = (s: string) => s.match(/[CBMGL]\d{2}/g) ?? [];
const rowsOf = (md: string, from: string, to: string) =>
  md
    .slice(md.indexOf(from), to ? md.indexOf(to) : undefined)
    .split("\n")
    .filter((l) => /^\| [FTUN]\d{2}/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

interface Q {
  id: string;
  type: "fact" | "time" | "tool" | "absent";
  store: string;
  question: string;
  current_time?: string;
  expected_facts: string[];
  expected_soon?: string[];
  confusable_facts: string[];
  expected_tool?: string;
  args?: Record<string, string>;
  requires_confirmation: boolean;
  safety: boolean;
  edited_by_user: boolean;
}
function parse(md: string): Q[] {
const rows = (from: string, to: string) => rowsOf(md, from, to);
const out: Q[] = [];

for (const [id, store, question, exp, conf, edit] of rows("## A.", "## B.")) {
  out.push({ id, type: "fact", store, question, expected_facts: ids(exp), confusable_facts: ids(conf), requires_confirmation: false, safety: false, edited_by_user: edit === "O" });
}
for (const [id, store, time, question, exp, edit] of rows("## B.", "## C.")) {
  const [now, soon = ""] = exp.split(/\/?\s*곧:/);
  const soonIds = ids(soon.replace(/M02\(03:00\)는 30분 밖.*/, "")); // 30분 밖 사실은 정답에서 제외
  out.push({ id, type: "time", store, question, current_time: time, expected_facts: [...ids(now), ...soonIds], expected_soon: soonIds, confusable_facts: [], requires_confirmation: false, safety: false, edited_by_user: edit === "O" });
}
for (const [id, store, question, tool, confirm, edit] of rows("## C.", "## D.")) {
  const m = tool.match(/`(\w+)\((.*)\)`/)!;
  const args: Record<string, string> = {};
  for (const p of m[2].split(/,\s*(?=\w+=)/)) {
    const k = p.indexOf("=");
    if (k > 0) args[p.slice(0, k)] = p.slice(k + 1);
    else args.mode = p;
  }
  out.push({ id, type: "tool", store, question, expected_facts: [], confusable_facts: [], expected_tool: m[1], args, requires_confirmation: confirm === "예", safety: false, edited_by_user: edit === "O" });
}
for (const [id, store, question, near, edit] of rows("## D.", "## 분포")) {
  out.push({ id: id.replace(/\s*★/, ""), type: "absent", store, question, expected_facts: [], confusable_facts: ids(near), requires_confirmation: false, safety: id.includes("★"), edited_by_user: edit === "O" });
}
return out;
}
const out = parse(readFileSync("eval/golden-draft.md", "utf8"));
const orig = parse(readFileSync("eval/golden-draft_original.md", "utf8"));
writeFileSync("eval/golden.jsonl", out.map((q) => JSON.stringify(q)).join("\n") + "\n");

// ---------- 검증 ----------
const problems: string[] = [];
const P = (id: string, why: string) => problems.push(`${id}: ${why}`);
const cnt = (t: string) => out.filter((q) => q.type === t).length;
console.log(`문항 ${out.length}개 (fact ${cnt("fact")} / time ${cnt("time")} / tool ${cnt("tool")} / absent ${cnt("absent")}), safety ${out.filter((q) => q.safety).length}`);
console.log(`사용자 수정 표시(edited_by_user): ${out.filter((q) => q.edited_by_user).length}/${out.length}`);

// (1) 사실 ID 존재 + 매장 일치
for (const q of out) {
  for (const f of [...q.expected_facts, ...q.confusable_facts]) if (!spans[f]) P(q.id, `사실 ID ${f}가 fact-spans.json에 없음`);
  for (const f of q.expected_facts) if (STORE[f[0]] !== q.store) P(q.id, `정답 사실 ${f}가 다른 매장(${STORE[f[0]]}) 소속`);
}
// (2) 도구 문항
const stepIds = new Set(sched.flatMap((s) => s.items.flatMap((i) => i.step_ids)));
for (const q of out.filter((x) => x.type === "tool")) {
  if (q.args?.step_id && !stepIds.has(q.args.step_id)) P(q.id, `step_id ${q.args.step_id}가 schedules.json에 없음`);
  for (const [k, v] of Object.entries(q.args ?? {})) {
    if (!["item", "qty", "date"].includes(k)) continue;
    if (!q.question.replace(/\s/g, "").includes(v.replace(/\s/g, ""))) P(q.id, `인자 ${k}=${v}가 질문에 없음`);
  }
}
// (3) 시각 문항: 사실 → 일정 step 대응표로 '지금(≤0분)'·'곧(1~30분)' 검증
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const FACT_STEPS: Record<string, string[]> = {
  C03: ["s1.machine_clean"], C04: ["s1.cake_waste"], C08: ["s1.lights_off"], C06: ["s1.closing_settle"],
  B04: ["s2.discount_sticker"], B01: ["s2.waste_sort"], B03: ["s2.waste_sort"], B07: ["s2.oven_cooldown"],
  M04: ["s3.drink_stock"], M02: ["s3.waste_check_00", "s3.waste_check_03", "s3.waste_check_06"],
  G04: ["s4.towel_receive"], L05: ["s5.meal_break"],
};
for (const q of out.filter((x) => x.type === "time")) {
  const store = sched.find((s) => s.store_id === q.store.toLowerCase())!;
  const cur = toMin(q.current_time!);
  const rel = (t: string) => {
    let d = toMin(t) - cur;
    if (d < -720) d += 1440;
    if (d > 720) d -= 1440;
    return d;
  };
  const soon = new Set(q.expected_soon);
  for (const f of q.expected_facts) {
    const ds = store.items.filter((i) => i.time && i.step_ids.some((s) => (FACT_STEPS[f] ?? []).includes(s))).map((i) => rel(i.time!));
    if (!ds.length) { P(q.id, `${f}에 대응하는 일정 없음`); continue; }
    const ok = soon.has(f) ? ds.some((d) => d > 0 && d <= 30) : ds.some((d) => d <= 0);
    if (!ok) P(q.id, `${f}: 일정 시차(${ds.join(",")}분)가 ${soon.has(f) ? "'곧(30분 이내)'" : "'지금'"}과 모순`);
  }
  for (const i of store.items) {
    if (!i.time || rel(i.time) <= 0 || rel(i.time) > 30) continue;
    for (const [f, ss] of Object.entries(FACT_STEPS)) {
      if (ss.some((s) => i.step_ids.includes(s)) && !soon.has(f)) P(q.id, `${i.time} 일정(${f})이 30분 이내인데 '곧' 정답에 빠짐`);
    }
  }
}
// (4) 문서에 없는 질문 — 핵심어가 코퍼스에 없어야 함
const KEY: Record<string, string[]> = {
  N01: ["원두"], N02: ["와이파이", "비번", "비밀번호"], N03: ["알레르기", "견과"], N04: ["몇 대 몇", "비율", "희석"],
  N05: ["시키", "발주"], N06: ["취한", "소리"], N07: ["환불", "돌려", "취소"], N08: ["다치", "부상", "119"],
  N09: ["지게차"], N10: ["교통비"],
};
const corpus = ["s1", "s2", "s3", "s4", "s5"]
  .flatMap((s) => [readFileSync(`data/virtual/${s}.txt`, "utf8"), readFileSync(`data/virtual/${s}.md`, "utf8")])
  .join("\n")
  .replace(/\s/g, "");
for (const q of out.filter((x) => x.type === "absent")) {
  const hits = (KEY[q.id] ?? []).filter((k) => corpus.includes(k.replace(/\s/g, "")));
  if (hits.length) P(q.id, `코퍼스에 핵심어 존재(${hits.join(",")}) — 답할 수 있는지 확인 필요`);
  if (!KEY[q.id]) P(q.id, "핵심어 목록 없음(검증 불가)");
}
// (5) 수정 효과 지표 — 현재 파일 기준 (초안 원문은 git 이력에 없음)
const factText: Record<string, string> = {};
for (const m of spec.matchAll(/^\| ([CBMGL]\d{2}) \| (.+?) \|/gm)) factText[m[1]] = m[2];
const bigrams = (s: string) => {
  const t = s.replace(/[^가-힣0-9a-zA-Z]/g, "");
  const set = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
};
const terms = new Set<string>();
for (const line of avoid.split("\n")) {
  if (!/^- (명사|동사):/.test(line)) continue;
  for (const raw of line.replace(/^- (명사|동사):/, "").split(",")) {
    const t = raw.trim();
    const p = t.match(/^(.*?)\((.*)\)$/);
    for (const v of p ? [p[1].trim(), p[2].trim()] : [t]) {
      const s = v.replace(/\s/g, "").replace(/(한다|ㄴ다)$/, "");
      if (s.length >= 2) terms.add(s);
    }
  }
}
const metric = (question: string, facts: string[]) => {
  const fb = new Set(facts.flatMap((f) => [...bigrams(factText[f] ?? "")]));
  const qb = bigrams(question);
  const overlap = qb.size ? [...qb].filter((b) => fb.has(b)).length / qb.size : 0;
  const qn = question.replace(/s/g, "");
  return { overlap, hit: [...terms].filter((t) => qn.includes(t)) };
};
const changed = out.filter((q) => q.question !== orig.find((o) => o.id === q.id)!.question);
console.log(`질문이 초안 원문과 다른 문항: ${changed.length}/${out.length} (수정 열 표시와 일치: ${changed.every((q) => q.edited_by_user) && changed.length === out.filter((q) => q.edited_by_user).length})`);
const tab: string[] = [];
const sum = { oo: 0, mo: 0, ot: 0, mt: 0 };
let n = 0;
for (const q of out.filter((x) => x.type === "fact" || x.type === "time")) {
  const o = orig.find((x) => x.id === q.id)!;
  const a = metric(o.question, q.expected_facts); // 정답 사실은 확정본 기준으로 동일하게 (T01 C06 포함)
  const b = metric(q.question, q.expected_facts);
  sum.oo += a.overlap; sum.mo += b.overlap; sum.ot += a.hit.length; sum.mt += b.hit.length; n++;
  tab.push(`| ${q.id} | ${(a.overlap * 100).toFixed(0)}% | ${(b.overlap * 100).toFixed(0)}% | ${a.hit.length} | ${b.hit.length} | ${b.hit.join(", ")} |`);
}
const avg = (x: number, pct = false) => (pct ? ((x / n) * 100).toFixed(1) + "%" : (x / n).toFixed(2));
const report = `# 골든셋 수정 효과 (초안 원문 vs 수정본)

- 원문: eval/golden-draft_original.md (설계 채팅 초안) / 수정본: eval/golden-draft.md (2026-09-30 확정)
- 대상: 사실+시각 ${n}문항. 도구·없음 문항은 제외
- 겹침 = 질문 글자 bigram 중 정답 사실 원문(data/virtual/corpus-spec.md)에도 있는 비율. 정답 사실은 두 쪽 모두 확정본 기준(T01의 C06 포함)
- avoid 용어 = eval/avoid-terms.md 용어(공백 제거·동사 어미 '한다' 제거 후 부분 일치)가 질문에 포함된 개수
- 사용자 수정 문항: ${out.filter((q) => q.edited_by_user).length}/${out.length} (도구 5문항 제외 시 ${out.filter((q) => q.edited_by_user).length}/${out.length - 5})

| | 원문 | 수정본 |
|---|---|---|
| 겹침 평균 | ${avg(sum.oo, true)} | ${avg(sum.mo, true)} |
| avoid 용어 평균 | ${avg(sum.ot)} | ${avg(sum.mt)} |

| 문항 | 겹침(원문) | 겹침(수정) | avoid(원문) | avoid(수정) | 수정본에 남은 용어 |
|---|---|---|---|---|---|
${tab.join("\n")}
`;
writeFileSync("eval/golden-edit-effect.md", report);
console.log(report.split("\n").slice(7, 12).join("\n"));
console.log(`\n문제 ${problems.length}건`);
for (const p of problems) console.log(" - " + p);
