// 채점 스크립트 (체크리스트 기반 v2 — 비결정성 해결)
// 입력 규약 (파일명 {name} 기준):
//   output/{name}.json              — AI 산출 문서 (convert.ts 결과)
//   golden/{name}.md                — 정답 문서
//   golden/{name}-checklist.json    — 원자적 사실 체크리스트 (npm run checklist 로 생성)
//   samples/{name}.txt              — (선택) 원본 트랜스크립트 — 환각 판정 근거
// 사용법:
//   npm run evaluate -- sample-handover              (이름 1개 이상)
//   npm run evaluate -- --all                        (golden/ 전체 배치)
//   npm run evaluate -- sample-handover --repeat 3   (같은 입력 N회 채점 — 재현성 확인)
// 결과: results/{name}-eval.md (+ .json)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

if (existsSync(".env")) process.loadEnvFile(".env");

// .env 로드 후 import (모델명이 env를 읽음)
const { runEvaluation, EVAL_MODEL, JUDGE_PROMPT_VERSION } = await import("../lib/ai/evaluate");
const { ChecklistSchema, missRate } = await import("../lib/ai/eval-schema");
const { DocumentSchema } = await import("../lib/ai/schema");
type EvalResult = import("../lib/ai/eval-schema").EvalResult;

async function evaluateOne(client: Anthropic, name: string, repeat: number): Promise<void> {
  console.log(`\n=== 채점: ${name}${repeat > 1 ? ` (${repeat}회 반복)` : ""}`);

  const aiPath = join("output", `${name}.json`);
  const goldenPath = join("golden", `${name}.md`);
  const checklistPath = join("golden", `${name}-checklist.json`);
  if (!existsSync(aiPath)) throw new Error(`AI 문서 없음: ${aiPath} (먼저 convert 실행)`);
  if (!existsSync(goldenPath)) throw new Error(`정답 문서 없음: ${goldenPath}`);
  if (!existsSync(checklistPath)) {
    throw new Error(`체크리스트 없음: ${checklistPath} — 먼저 실행: npm run checklist -- ${name}`);
  }

  const aiDocument = DocumentSchema.parse(JSON.parse(readFileSync(aiPath, "utf-8")).document);
  const checklist = ChecklistSchema.parse(JSON.parse(readFileSync(checklistPath, "utf-8"))).items;
  const goldenMarkdown = readFileSync(goldenPath, "utf-8");
  const transcriptPath = join("samples", `${name}.txt`);
  const transcriptText = existsSync(transcriptPath)
    ? readFileSync(transcriptPath, "utf-8")
    : undefined;

  const runs: EvalResult[] = [];
  for (let i = 0; i < repeat; i++) {
    const { result, meta } = await runEvaluation(client, {
      checklist,
      aiDocument,
      transcriptText,
      goldenMarkdown,
    });
    runs.push(result);
    const rate = (missRate(result) * 100).toFixed(1);
    console.log(
      `  ${repeat > 1 ? `[${i + 1}회] ` : ""}누락률 ${rate}% (${result.missedItems.length}/${result.goldenKeyItemCount})` +
        ` · 환각 ${result.hallucinations.length}건 · 토큰 in=${meta.inputTokens} out=${meta.outputTokens}`
    );
  }

  // 재현성: 누락 항목 집합이 회차 간 동일한지
  if (repeat > 1) {
    const keys = runs.map((r) =>
      JSON.stringify({
        m: r.missedItems.map((m) => m.item).sort(),
        h: r.hallucinations.map((h) => h.item).sort(),
      })
    );
    const identical = keys.every((k) => k === keys[0]);
    console.log(`  재현성: ${identical ? "✓ 전 회차 동일" : "✗ 회차 간 차이 있음"}`);
    if (!identical) {
      for (let i = 0; i < runs.length; i++) {
        console.log(`    [${i + 1}회] 누락: ${runs[i].missedItems.map((m) => m.item).join(" | ") || "없음"}`);
      }
    }
  }

  const result = runs[runs.length - 1];
  mkdirSync("results", { recursive: true });
  writeFileSync(join("results", `${name}-eval.json`), JSON.stringify(result, null, 2), "utf-8");
  writeFileSync(join("results", `${name}-eval.md`), renderEvalMarkdown(name, result), "utf-8");
  console.log(`  → results/${name}-eval.md`);
}

function renderEvalMarkdown(name: string, r: EvalResult): string {
  const rate = (missRate(r) * 100).toFixed(1);
  const criticalMissed = r.missedItems.filter((m) => m.critical);
  const lines: string[] = [
    `# 채점 결과: ${name}`,
    "",
    `- 심판 모델: ${EVAL_MODEL} / 프롬프트: ${JUDGE_PROMPT_VERSION} (체크리스트 기반, temperature 0)`,
    `- **누락률: ${rate}%** (${r.missedItems.length} / 체크리스트 ${r.goldenKeyItemCount}개) — 목표 <10%`,
    `- **critical 누락: ${criticalMissed.length}건** — 목표 0건`,
    `- **환각: ${r.hallucinations.length}건** — 목표 0건`,
    "",
    "## 누락 항목",
    "",
  ];
  if (r.missedItems.length === 0) lines.push("_없음_");
  for (const m of r.missedItems) {
    lines.push(`- ${m.critical ? "⚠ **critical** " : ""}[${m.section}] ${m.item}`);
  }

  lines.push("", "## 환각 항목", "");
  if (r.hallucinations.length === 0) lines.push("_없음_");
  for (const h of r.hallucinations) lines.push(`- ${h.item}`, `  - 판정 근거: ${h.reason}`);

  lines.push("", "## AI 보완 항목 (inferred — 환각 아님, 작성자 확인 대상)", "");
  if (r.inferredClaims.length === 0) lines.push("_없음_");
  for (const c of r.inferredClaims) lines.push(`- ${c}`);

  lines.push("");
  return lines.join("\n");
}

const argv = process.argv.slice(2);
const repeatIdx = argv.indexOf("--repeat");
const repeat = repeatIdx >= 0 ? Math.max(1, Number(argv[repeatIdx + 1]) || 1) : 1;
let names = argv.filter(
  (a, i) => a !== "--all" && !(repeatIdx >= 0 && (i === repeatIdx || i === repeatIdx + 1))
);
if (argv.includes("--all")) {
  if (!existsSync("golden")) {
    console.error("golden/ 폴더가 없습니다. 정답 문서(golden/{name}.md)를 먼저 작성하세요.");
    process.exitCode = 1;
  } else {
    names = readdirSync("golden")
      .filter((f) => f.endsWith(".md"))
      .map((f) => basename(f, ".md"));
  }
}
if (names.length === 0) {
  console.error("사용법: npm run evaluate -- <이름...> 또는 --all [--repeat N]");
  process.exitCode = 1;
} else {
  const client = new Anthropic();
  let failed = 0;
  for (const name of names) {
    try {
      await evaluateOne(client, name, repeat);
    } catch (e) {
      failed++;
      console.error(`  실패: ${e instanceof Error ? e.message : e}`);
    }
  }
  process.exitCode = failed > 0 ? 1 : 0;
}
