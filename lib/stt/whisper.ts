import type { SttInput, SttProvider, Transcript, TranscriptSegment } from "./types";

// OpenAI Whisper API 연동 (한국어, 세그먼트 타임스탬프 포함)
// SDK 미사용 — multipart 1개 엔드포인트라 fetch+FormData로 충분 (의존성 최소화)

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
// Whisper API 파일 상한 25MB. 초과 영상은 오디오 추출 필요.
// TODO: 25MB 초과 시 ffmpeg로 오디오만 추출(m4a) 후 전송 — 실영상 테스트 후 추가
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

interface WhisperVerboseResponse {
  language?: string;
  segments?: { start: number; end: number; text: string }[];
  text?: string;
}

/** verbose_json 응답 → 내부 Transcript (순수 함수 — vitest 대상) */
export function whisperResponseToTranscript(res: WhisperVerboseResponse): Transcript {
  const segments: TranscriptSegment[] =
    res.segments && res.segments.length > 0
      ? res.segments
          .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
          .filter((s) => s.text.length > 0)
      : res.text?.trim()
        ? [{ start: null, end: null, text: res.text.trim() }]
        : [];
  return { segments, language: res.language ?? "ko", source: "whisper" };
}

export class WhisperStt implements SttProvider {
  constructor(private apiKey = process.env.OPENAI_API_KEY) {}

  async transcribe(input: SttInput): Promise<Transcript> {
    if (!this.apiKey) {
      throw new Error(
        "OPENAI_API_KEY가 없습니다. .env에 키를 추가하거나, 영상 대신 트랜스크립트 .txt 파일을 업로드하세요."
      );
    }
    if (input.data.byteLength > WHISPER_MAX_BYTES) {
      const mb = (input.data.byteLength / 1024 / 1024).toFixed(0);
      throw new Error(
        `파일이 Whisper 상한(25MB)을 초과합니다 (${mb}MB). 영상을 짧게 나누거나 트랜스크립트 .txt를 업로드하세요.`
      );
    }

    const form = new FormData();
    form.append("file", new Blob([input.data as BufferSource]), input.filename);
    form.append("model", "whisper-1");
    form.append("language", "ko");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const res = await fetch(WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Whisper API 실패 (HTTP ${res.status}): ${body.slice(0, 300)}`);
    }
    return whisperResponseToTranscript((await res.json()) as WhisperVerboseResponse);
  }
}
