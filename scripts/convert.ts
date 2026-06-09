// 변환 품질 검증 CLI (Phase 0 세션 0-1)
// 사용법:
//   npm run convert -- samples/sample-handover.txt        (트랜스크립트 직접 입력)
//   npm run convert -- recording.mp4                       (영상 — 현재 STT mock, 에러 안내)
// 결과: output/{파일명}.json + output/{파일명}.md

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parseTranscriptText, transcriptToPromptText } from "../lib/stt/parse-txt";
import { WhisperStt } from "../lib/stt/whisper";
import { structureTranscript } from "../lib/ai/structure";
import { renderMarkdown } from "../lib/render-md";
import type { Transcript } from "../lib/stt/types";

if (existsSync(".env")) process.loadEnvFile(".env");

const TEXT_EXTS = new Set([".txt", ".md"]);
const MEDIA_EXTS = new Set([".mp4", ".webm", ".m4a", ".mp3", ".wav"]);

async function getTranscript(filePath: string): Promise<Transcript> {
  const ext = extname(filePath).toLowerCase();
  if (TEXT_EXTS.has(ext)) {
    return parseTranscriptText(readFileSync(filePath, "utf-8"));
  }
  if (MEDIA_EXTS.has(ext)) {
    return new WhisperStt().transcribe(filePath); // TODO: OPENAI_API_KEY 확보 후 실제 STT
  }
  throw new Error(`지원하지 않는 확장자: ${ext} (지원: .txt .md / ${[...MEDIA_EXTS].join(" ")})`);
}

async function convertOne(filePath: string): Promise<void> {
  const name = basename(filePath, extname(filePath));
  console.log(`\n=== 변환: ${filePath}`);

  const transcript = await getTranscript(filePath);
  console.log(`  세그먼트 ${transcript.segments.length}개 (source=${transcript.source})`);

  const promptText = transcriptToPromptText(transcript);
  const result = await structureTranscript(promptText);

  mkdirSync("output", { recursive: true });
  const jsonPath = join("output", `${name}.json`);
  const mdPath = join("output", `${name}.md`);

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

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("사용법: npm run convert -- <파일 경로...>  (.txt/.md 트랜스크립트 또는 영상/오디오)");
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  try {
    await convertOne(f);
  } catch (e) {
    failed++;
    console.error(`  실패: ${e instanceof Error ? e.message : e}`);
  }
}
// process.exit()는 Windows에서 libuv assertion 유발 → exitCode로 자연 종료
process.exitCode = failed > 0 ? 1 : 0;
