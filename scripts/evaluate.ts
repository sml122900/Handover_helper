// 채점 스크립트 (Phase 0 세션 0-2)
// 입력 규약 (파일명 {name} 기준):
//   output/{name}.json   — AI 산출 문서 (convert.ts 결과)
//   golden/{name}.md     — 사람이 작성한 정답 문서
//   samples/{name}.txt   — (선택) 원본 트랜스크립트 — 환각 판정 정확도 향상
// 사용법:
//   npm run evaluate -- sample-handover          (이름 1개 이상)
//   npm run evaluate -- --all                    (golden/ 전체 배치)
// 결과: results/{name}-eval.md (+ .json)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { missRate, type EvalResult } from "../lib/ai/eval-schema";

if (existsSync(".env")) process.loadEnvFile(".env");

// .env 로드 후 import (EVAL_MODEL이 env를 읽음)
const { runEvaluation, EVAL_MODEL, EVAL_PROMPT_VERSION } = await import("../lib/ai/evaluate");

async function evaluateOne(client: Anthropic, name: string): Promise<void> {
  console.log(`\n=== 채점: ${name}`);

  const aiPath = join("output", `${name}.json`);
  const goldenPath = join("golden", `${name}.md`);
  if (!existsSync(aiPath)) throw new Error(`AI 문서 없음: ${aiPath} (먼저 convert 실행)`);
  if (!existsSync(goldenPath)) throw new Error(`정답 문서 없음: ${goldenPath}`);

  const aiDocumentJson = JSON.stringify(JSON.parse(readFileSync(aiPath, "utf-8")).document, null, 2);
  const goldenMarkdown = readFileSync(goldenPath, "utf-8");
  const transcriptPath = join("samples", `${name}.txt`);
  const transcriptText = existsSync(transcriptPath)
    ? readFileSync(transcriptPath, "utf-8")
    : undefined;

  const { result, meta } = await runEvaluation(client, {
    goldenMarkdown,
    aiDocumentJson,
    transcriptText,
  });

  mkdirSync("results", { recursive: true });
  writeFileSync(join("results", `${name}-eval.json`), JSON.stringify(result, null, 2), "utf-8");
  writeFileSync(join("results", `${name}-eval.md`), renderEvalMarkdown(name, result), "utf-8");

  const rate = (missRate(result) * 100).toFixed(1);
  console.log(
    `  누락률 ${rate}% (${result.missedItems.length}/${result.goldenKeyItemCount}) · 환각 ${result.hallucinations.length}건` +
      ` · 토큰 in=${meta.inputTokens} out=${meta.outputTokens}` +
      `\n  → results/${name}-eval.md`
  );
}

function renderEvalMarkdown(name: string, r: EvalResult): string {
  const rate = (missRate(r) * 100).toFixed(1);
  const lines: string[] = [
    `# 채점 결과: ${name}`,
    "",
    `- 심판 모델: ${EVAL_MODEL} / 프롬프트: ${EVAL_PROMPT_VERSION}`,
    `- **누락률: ${rate}%** (${r.missedItems.length} / 핵심 정보 ${r.goldenKeyItemCount}개) — 목표 <10%`,
    `- **환각: ${r.hallucinations.length}건** — 목표 0건`,
    "",
    "## 누락 항목",
    "",
  ];
  if (r.missedItems.length === 0) lines.push("_없음_");
  for (const m of r.missedItems) lines.push(`- [${m.section}] ${m.item}`);

  lines.push("", "## 환각 항목", "");
  if (r.hallucinations.length === 0) lines.push("_없음_");
  for (const h of r.hallucinations) lines.push(`- ${h.item}`, `  - 근거: ${h.reason}`);

  lines.push("", "## 섹션별 점수", "", "| 섹션 | 점수 | 코멘트 |", "| --- | --- | --- |");
  for (const s of r.sectionScores) lines.push(`| ${s.section} | ${s.score}/10 | ${s.comment} |`);

  lines.push("", "## 총평", "", r.overallComment, "");
  return lines.join("\n");
}

let names = process.argv.slice(2).filter((a) => a !== "--all");
if (process.argv.includes("--all")) {
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
  console.error("사용법: npm run evaluate -- <이름...> 또는 --all");
  process.exitCode = 1;
} else {
  const client = new Anthropic();
  let failed = 0;
  for (const name of names) {
    try {
      await evaluateOne(client, name);
    } catch (e) {
      failed++;
      console.error(`  실패: ${e instanceof Error ? e.message : e}`);
    }
  }
  process.exitCode = failed > 0 ? 1 : 0;
}
