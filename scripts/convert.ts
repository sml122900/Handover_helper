// 변환 품질 검증 CLI (Phase 0 세션 0-1)
// 사용법:
//   npm run convert -- samples/sample-handover.txt              (트랜스크립트 직접 입력)
//   npm run convert -- recording.mp4                             (영상 — OPENAI_API_KEY 있으면 Whisper STT)
//   npm run convert -- samples/x.txt --prompt structure-v2       (프롬프트 버전 지정)
// 결과: output/{파일명}.json + .md (GOLDEN_DIR가 비공개 경로면 그 상위의 output/)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Transcript } from "../lib/stt/types";

if (existsSync(".env")) process.loadEnvFile(".env");

// .env 로드 후 import (모델명·STT 프로바이더가 env를 읽음)
const { parseTranscriptText, transcriptToPromptText } = await import("../lib/stt/parse-txt");
const { getSttProvider } = await import("../lib/stt");
const { structureTranscript } = await import("../lib/ai/structure");
const { renderMarkdown } = await import("../lib/render-md");
const { OUTPUT_DIR } = await import("../lib/golden-paths");
const { maskDeep } = await import("../lib/privacy/mask");

const TEXT_EXTS = new Set([".txt", ".md"]);
const MEDIA_EXTS = new Set([".mp4", ".webm", ".m4a", ".mp3", ".wav"]);

async function getTranscript(filePath: string): Promise<Transcript> {
  const ext = extname(filePath).toLowerCase();
  if (TEXT_EXTS.has(ext)) {
    return parseTranscriptText(readFileSync(filePath, "utf-8"));
  }
  if (MEDIA_EXTS.has(ext)) {
    return getSttProvider().transcribe({
      data: new Uint8Array(readFileSync(filePath)),
      filename: basename(filePath),
    });
  }
  throw new Error(`지원하지 않는 확장자: ${ext} (지원: .txt .md / ${[...MEDIA_EXTS].join(" ")})`);
}

async function convertOne(filePath: string, promptVersion?: string): Promise<void> {
  const name = basename(filePath, extname(filePath));
  console.log(`\n=== 변환: ${filePath}`);

  const transcript = maskDeep(await getTranscript(filePath)); // 마스킹 1차
  console.log(`  세그먼트 ${transcript.segments.length}개 (source=${transcript.source})`);

  const promptText = transcriptToPromptText(transcript);
  const structured = await structureTranscript(promptText, { promptVersion });
  const result = { ...structured, document: maskDeep(structured.document) }; // 마스킹 2차

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const jsonPath = join(OUTPUT_DIR, `${name}.json`);
  const mdPath = join(OUTPUT_DIR, `${name}.md`);

  writeFileSync(
    jsonPath,
    JSON.stringify({ document: result.document, meta: result.meta }, null, 2),
    "utf-8"
  );
  writeFileSync(mdPath, renderMarkdown(result.document, name), "utf-8");

  // 토큰 사용량 기록 (Phase 0: 콘솔 + JSON meta. DB 기록은 Phase 1)
  console.log(
    `  완료 → ${jsonPath}, ${mdPath}\n` +
      `  모델=${result.meta.model} 프롬프트=${result.meta.promptVersion} ` +
      `토큰 in=${result.meta.inputTokens} out=${result.meta.outputTokens} 시도=${result.meta.attempts}`
  );
}

const args = process.argv.slice(2);
const promptIdx = args.indexOf("--prompt");
const promptVersion = promptIdx >= 0 ? args[promptIdx + 1] : undefined;
const files = args.filter((_, i) => !(promptIdx >= 0 && (i === promptIdx || i === promptIdx + 1)));

if (files.length === 0) {
  console.error(
    "사용법: npm run convert -- <파일 경로...> [--prompt structure-v2]  (.txt/.md 트랜스크립트 또는 영상/오디오)"
  );
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  try {
    await convertOne(f, promptVersion);
  } catch (e) {
    failed++;
    console.error(`  실패: ${e instanceof Error ? e.message : e}`);
  }
}
// process.exit()는 Windows에서 libuv assertion 유발 → exitCode로 자연 종료
process.exitCode = failed > 0 ? 1 : 0;
