// 프롬프트 버전 비교 (Phase 0 골든셋 반복용)
// golden/ 전체 샘플을 각 버전으로 변환+채점하고 버전별 누락률·환각 비교표 출력.
// 사용법:
//   npm run compare -- structure-v1 structure-v2        (버전 1개 이상)
//   npm run compare -- structure-v1 structure-v2 --force (캐시 무시, 전부 재호출)
// 캐시 (반복 비용 절약 — 같은 샘플×버전은 재호출 안 함):
//   output/compare/{name}@{version}.json        — 변환 결과
//   results/compare/{name}@{version}-eval.json  — 채점 결과
// 결과: results/compare-{v1}-vs-{v2}.md (비교표 + 버전별 섹션 누락 집계)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

if (existsSync(".env")) process.loadEnvFile(".env");

// .env 로드 후 import (모델명이 env를 읽음)
const { structureTranscript } = await import("../lib/ai/structure");
const { runEvaluation } = await import("../lib/ai/evaluate");
const { getStructurePrompt } = await import("../lib/ai/prompts");
const { parseTranscriptText, transcriptToPromptText } = await import("../lib/stt/parse-txt");
const { EvalResultSchema } = await import("../lib/ai/eval-schema");
const { renderCompareTable, aggregateMissesBySection, renderSectionMissReport, summarizeByVersion } =
  await import("../lib/ai/compare-report");
type SampleEvalRow = import("../lib/ai/compare-report").SampleEvalRow;

const force = process.argv.includes("--force");
const versions = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (versions.length === 0) {
  console.error("사용법: npm run compare -- <버전...> [--force]  예) structure-v1 structure-v2");
  process.exitCode = 1;
} else {
  try {
    versions.forEach((v) => getStructurePrompt(v)); // 미등록 버전 조기 실패
    await main();
  } catch (e) {
    console.error(`실패: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  if (!existsSync("golden")) {
    throw new Error("golden/ 폴더가 없습니다. 정답 문서(golden/{name}.md)를 먼저 작성하세요.");
  }
  const names = readdirSync("golden")
    .filter((f) => f.endsWith(".md"))
    .map((f) => basename(f, ".md"))
    .filter((name) => {
      if (existsSync(join("samples", `${name}.txt`))) return true;
      console.warn(`  건너뜀: samples/${name}.txt 없음 (변환 입력 필요)`);
      return false;
    });
  if (names.length === 0) throw new Error("비교할 샘플이 없습니다 (golden/{name}.md + samples/{name}.txt 쌍 필요).");

  mkdirSync(join("output", "compare"), { recursive: true });
  mkdirSync(join("results", "compare"), { recursive: true });

  const client = new Anthropic();
  const rows: SampleEvalRow[] = [];
  let apiCalls = 0;

  for (const name of names) {
    const transcriptText = readFileSync(join("samples", `${name}.txt`), "utf-8");
    const promptText = transcriptToPromptText(parseTranscriptText(transcriptText));
    const goldenMarkdown = readFileSync(join("golden", `${name}.md`), "utf-8");

    for (const version of versions) {
      // 1) 변환 (캐시)
      const convPath = join("output", "compare", `${name}@${version}.json`);
      let documentJson: string;
      if (!force && existsSync(convPath)) {
        documentJson = JSON.stringify(JSON.parse(readFileSync(convPath, "utf-8")).document, null, 2);
        console.log(`  [캐시] 변환 ${name} × ${version}`);
      } else {
        const r = await structureTranscript(promptText, { promptVersion: version });
        apiCalls++;
        writeFileSync(convPath, JSON.stringify({ document: r.document, meta: r.meta }, null, 2), "utf-8");
        documentJson = JSON.stringify(r.document, null, 2);
        console.log(`  변환 ${name} × ${version} — 토큰 in=${r.meta.inputTokens} out=${r.meta.outputTokens}`);
      }

      // 2) 채점 (캐시)
      const evalPath = join("results", "compare", `${name}@${version}-eval.json`);
      if (!force && existsSync(evalPath)) {
        rows.push({ name, version, result: EvalResultSchema.parse(JSON.parse(readFileSync(evalPath, "utf-8"))) });
        console.log(`  [캐시] 채점 ${name} × ${version}`);
      } else {
        const { result, meta } = await runEvaluation(client, {
          goldenMarkdown,
          aiDocumentJson: documentJson,
          transcriptText,
        });
        apiCalls++;
        writeFileSync(evalPath, JSON.stringify(result, null, 2), "utf-8");
        rows.push({ name, version, result });
        console.log(`  채점 ${name} × ${version} — 토큰 in=${meta.inputTokens} out=${meta.outputTokens}`);
      }
    }
  }

  // 3) 리포트
  const table = renderCompareTable(rows, versions);
  const sections = versions
    .map((v) =>
      renderSectionMissReport(
        aggregateMissesBySection(rows.filter((r) => r.version === v)),
        `섹션별 누락 집계 — ${v}`
      )
    )
    .join("\n");
  const md = [
    `# 프롬프트 비교: ${versions.join(" vs ")}`,
    "",
    `- 샘플 ${names.length}개 · API 호출 ${apiCalls}회 (캐시 제외) · ${new Date().toISOString().slice(0, 10)}`,
    `- 목표: 누락률 <10% / 환각 0건`,
    "",
    "## 비교표",
    "",
    table,
    "",
    sections,
  ].join("\n");

  const outPath = join("results", `compare-${versions.join("-vs-")}.md`);
  writeFileSync(outPath, md, "utf-8");

  console.log(`\n${table}\n`);
  for (const t of summarizeByVersion(rows)) {
    console.log(
      `  ${t.version}: 누락률 ${(t.missRate * 100).toFixed(1)}% (${t.missed}/${t.keyItems}) · 환각 ${t.hallucinations}건`
    );
  }
  console.log(`\n→ ${outPath} (API 호출 ${apiCalls}회)`);
}
