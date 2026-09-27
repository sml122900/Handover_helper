// 정답 문서 → 원자적 사실 체크리스트 (채점 분모 고정 — 비결정성 해결)
// 사용법:
//   npm run checklist -- sample-handover          (이름 1개 이상)
//   npm run checklist -- --all                    (GOLDEN_DIR/*.md 전체, 기본 ./golden)
//   npm run checklist -- sample-handover --force  (캐시 무시 재생성)
// 결과: {GOLDEN_DIR}/{name}-checklist.json (캐시 — 있으면 호출 0회)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

if (existsSync(".env")) process.loadEnvFile(".env");

const { GOLDEN_DIR, listGoldenNames } = await import("../lib/golden-paths");
const { buildChecklist, CHECKLIST_MODEL, CHECKLIST_PROMPT_VERSION } = await import(
  "../lib/ai/checklist"
);

const force = process.argv.includes("--force");
let names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) {
  names = listGoldenNames();
}

if (names.length === 0) {
  console.error("사용법: npm run checklist -- <이름...> 또는 --all [--force]");
  process.exitCode = 1;
} else {
  const client = new Anthropic();
  let failed = 0;
  for (const name of names) {
    try {
      const goldenPath = join(GOLDEN_DIR, `${name}.md`);
      if (!existsSync(goldenPath)) throw new Error(`정답 문서 없음: ${goldenPath}`);
      const outPath = join(GOLDEN_DIR, `${name}-checklist.json`);

      if (!force && existsSync(outPath)) {
        const cached = JSON.parse(readFileSync(outPath, "utf-8"));
        console.log(`[캐시] ${name}: ${cached.items.length}개 항목 (재생성: --force)`);
        continue;
      }

      const { items, meta } = await buildChecklist(client, readFileSync(goldenPath, "utf-8"));
      writeFileSync(
        outPath,
        JSON.stringify(
          { promptVersion: CHECKLIST_PROMPT_VERSION, model: meta.model, items },
          null,
          2
        ),
        "utf-8"
      );
      const critical = items.filter((i) => i.critical).length;
      console.log(
        `${name}: ${items.length}개 항목 (critical ${critical}) — 토큰 in=${meta.inputTokens} out=${meta.outputTokens} → ${outPath}`
      );
      console.log(`  ⚠ 체크리스트를 직접 검토하세요 — 분모가 채점 기준이 됩니다`);
    } catch (e) {
      failed++;
      console.error(`${name} 실패: ${e instanceof Error ? e.message : e}`);
    }
  }
  process.exitCode = failed > 0 ? 1 : 0;
}
