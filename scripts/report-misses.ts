// 섹션별 누락 집계 리포트 (API 호출 0회)
// results/*-eval.json (evaluate.ts 산출) 전체를 읽어 어느 섹션에서 누락이 반복되는지 집계.
// 사용법: npm run report
// 결과: results/miss-report.md + 콘솔 표

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EvalResultSchema } from "../lib/ai/eval-schema";
import { aggregateMissesBySection, renderSectionMissReport } from "../lib/ai/compare-report";

if (!existsSync("results")) {
  console.error("results/ 폴더가 없습니다. 먼저 npm run evaluate 를 실행하세요.");
  process.exitCode = 1;
} else {
  const files = readdirSync("results").filter((f) => f.endsWith("-eval.json"));
  if (files.length === 0) {
    console.error("results/*-eval.json 이 없습니다. 먼저 npm run evaluate 를 실행하세요.");
    process.exitCode = 1;
  } else {
    const evals = files.flatMap((f) => {
      const parsed = EvalResultSchema.safeParse(
        JSON.parse(readFileSync(join("results", f), "utf-8"))
      );
      if (!parsed.success) {
        console.warn(`  건너뜀: ${f} — 구 포맷 (재채점: npm run evaluate)`);
        return [];
      }
      return [{ name: f.replace(/-eval\.json$/, ""), result: parsed.data }];
    });

    const misses = aggregateMissesBySection(evals);
    const md = [
      `# 섹션별 누락 리포트`,
      "",
      `- 채점 결과 ${evals.length}개 집계 (${evals.map((e) => e.name).join(", ")})`,
      "",
      renderSectionMissReport(misses, "섹션별 누락 집계"),
    ].join("\n");
    writeFileSync(join("results", "miss-report.md"), md, "utf-8");

    if (misses.length === 0) {
      console.log("누락 없음 ✓");
    } else {
      console.log(`섹션별 누락 (채점 ${evals.length}개 집계):`);
      for (const m of misses) console.log(`  ${m.section}: ${m.count}건`);
    }
    console.log(`→ results/miss-report.md`);
  }
}
