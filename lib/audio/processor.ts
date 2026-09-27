import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transcript, TranscriptSegment } from "../stt/types";
import { getSttProvider } from "../stt";

// STT 오디오 처리 파이프라인:
// 1) 영상/오디오 → ffmpeg으로 mp3 추출 (1GB 영상 → ~30MB mp3)
// 2) 25MB 초과 시 10분 단위 청크 분할
// 3) 청크별 STT → 타임스탬프 offset 보정 후 병합
// 설계 원칙: 이 함수 단위로 Inngest 작업 큐로 이전 가능
//
// 현재: HANDOVER_STT=mock 또는 OPENAI_API_KEY 없으면 STT 에러 (환각 방지 — mock 트랜스크립트 생성 금지)

const execFileAsync = promisify(execFile);

const CHUNK_DURATION_SECONDS = 600; // 10분
const STT_MAX_BYTES = 25 * 1024 * 1024; // 25MB (Whisper 한도)

async function ffmpegPath(): Promise<string> {
  const mod = await import("ffmpeg-static");
  const p = mod.default as unknown as string | null;
  if (!p) throw new Error("ffmpeg 바이너리를 찾을 수 없습니다 (ffmpeg-static).");
  console.log("[ffmpeg] path:", p);
  return p;
}

/** 영상/오디오 Buffer → mp3 Buffer (ffmpeg) */
async function extractAudio(inputData: Buffer, inputExt: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "handover-audio-"));
  try {
    const inputPath = join(dir, `input.${inputExt}`);
    const outputPath = join(dir, "audio.mp3");
    await writeFile(inputPath, inputData);

    const ffmpeg = await ffmpegPath();
    await execFileAsync(
      ffmpeg,
      ["-i", inputPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k", outputPath],
      { maxBuffer: 256 * 1024 * 1024, windowsHide: true }
    );

    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** mp3 Buffer를 N초 단위 청크로 분할. 각 청크의 시작 offset(초)도 반환 */
async function splitAudio(
  audioData: Buffer,
  chunkSeconds: number
): Promise<Array<{ data: Buffer; offsetSeconds: number }>> {
  const dir = await mkdtemp(join(tmpdir(), "handover-chunks-"));
  try {
    const inputPath = join(dir, "audio.mp3");
    await writeFile(inputPath, audioData);

    const ffmpeg = await ffmpegPath();
    // -f segment: 청크 분할, -segment_time: 청크 길이
    await execFileAsync(
      ffmpeg,
      [
        "-i", inputPath,
        "-f", "segment",
        "-segment_time", String(chunkSeconds),
        "-c", "copy",
        join(dir, "chunk_%03d.mp3"),
      ],
      { maxBuffer: 256 * 1024 * 1024, windowsHide: true }
    );

    // 생성된 청크 파일을 순서대로 수집
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(dir))
      .filter((f) => f.startsWith("chunk_"))
      .sort();

    const chunks: Array<{ data: Buffer; offsetSeconds: number }> = [];
    for (let i = 0; i < files.length; i++) {
      const data = await readFile(join(dir, files[i]));
      chunks.push({ data, offsetSeconds: i * chunkSeconds });
    }
    return chunks;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** STT 결과 세그먼트에 offset(초)를 더해 타임스탬프 보정 */
function applyOffset(segments: TranscriptSegment[], offsetSeconds: number): TranscriptSegment[] {
  if (offsetSeconds === 0) return segments;
  return segments.map((s) => ({
    ...s,
    start: s.start !== null ? s.start + offsetSeconds : null,
    end: s.end !== null ? s.end + offsetSeconds : null,
  }));
}

/**
 * 영상/오디오 Buffer → Transcript
 * Inngest 전환 시 이 함수를 그대로 작업 핸들러로 이동 가능.
 */
export async function processAudio(
  inputData: Buffer,
  inputExt: string,
  filename: string
): Promise<Transcript> {
  const stt = getSttProvider();

  // 오디오 추출 (영상이면 mp3로 변환, 이미 mp3/m4a면 그대로 사용 가능하지만 포맷 통일)
  const audioData = await extractAudio(inputData, inputExt);

  const audioSizeBytes = audioData.byteLength;

  // 25MB 이하: 청크 분할 없이 바로 STT
  if (audioSizeBytes <= STT_MAX_BYTES) {
    return stt.transcribe({
      data: new Uint8Array(audioData),
      filename: filename.replace(/\.[^.]+$/, ".mp3"),
    });
  }

  // 25MB 초과: 청크 분할 후 각각 STT → 병합
  const chunks = await splitAudio(audioData, CHUNK_DURATION_SECONDS);
  const allSegments: TranscriptSegment[] = [];
  let language = "ko";
  let source: Transcript["source"] = "whisper";

  for (const chunk of chunks) {
    const result = await stt.transcribe({
      data: new Uint8Array(chunk.data),
      filename: `chunk_${chunk.offsetSeconds}s.mp3`,
    });
    const corrected = applyOffset(result.segments, chunk.offsetSeconds);
    allSegments.push(...corrected);
    language = result.language; // 마지막 청크 언어 사용
    source = result.source; // 실제 provider 기록
  }

  return { segments: allSegments, language, source };
}
