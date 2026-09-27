import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// 골든셋 경로 — GOLDEN_DIR (기본 ./golden). 규칙: golden/README.md
// 비공개 골든셋(예: ./private-data/golden)이면 output/results도 그 상위 폴더에 저장
// → 심판 근거 인용(실데이터 문장)이 공개 리포 경로에 섞이지 않게
export const GOLDEN_DIR = process.env.GOLDEN_DIR || "golden";
const ARTIFACT_ROOT = resolve(GOLDEN_DIR) === resolve("golden") ? "." : dirname(GOLDEN_DIR);
export const OUTPUT_DIR = join(ARTIFACT_ROOT, "output");
export const RESULTS_DIR = join(ARTIFACT_ROOT, "results");

/** 트랜스크립트: GOLDEN_DIR/{name}.txt 우선, 없으면 samples/{name}.txt */
export function transcriptPath(name: string): string {
  const inGolden = join(GOLDEN_DIR, `${name}.txt`);
  return existsSync(inGolden) ? inGolden : join("samples", `${name}.txt`);
}

/** 정답 문서 이름 목록 ({name}.md, README.md 제외) */
export function listGoldenNames(): string[] {
  if (!existsSync(GOLDEN_DIR)) return [];
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => basename(f, ".md"));
}
