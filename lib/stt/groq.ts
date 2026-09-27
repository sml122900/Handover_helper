import type { SttInput, SttProvider, Transcript, TranscriptSegment } from "./types";

// Groq Whisper API 연동 (OpenAI Whisper 호환 엔드포인트, 처리 속도 빠름)
// Groq는 25MB 제한이 동일하게 적용됨
// SDK 미사용 — OpenAI Whisper와 동일한 multipart 형식 사용

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_MAX_BYTES = 25 * 1024 * 1024;

interface GroqVerboseResponse {
  language?: string;
  segments?: { start: number; end: number; text: string }[];
  text?: string;
}

export function groqResponseToTranscript(res: GroqVerboseResponse): Transcript {
  const segments: TranscriptSegment[] =
    res.segments && res.segments.length > 0
      ? res.segments
          .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
          .filter((s) => s.text.length > 0)
      : res.text?.trim()
        ? [{ start: null, end: null, text: res.text.trim() }]
        : [];
  return { segments, language: res.language ?? "ko", source: "groq" };
}

export class GroqStt implements SttProvider {
  constructor(private apiKey = process.env.GROQ_API_KEY) {}

  async transcribe(input: SttInput): Promise<Transcript> {
    if (!this.apiKey) {
      throw new Error(
        "GROQ_API_KEY가 없습니다. .env에 키를 추가하거나, HANDOVER_STT=whisper (OpenAI) 또는 txt 파일을 사용하세요."
      );
    }
    if (input.data.byteLength > GROQ_MAX_BYTES) {
      const mb = (input.data.byteLength / 1024 / 1024).toFixed(0);
      throw new Error(
        `파일이 Groq Whisper 상한(25MB)을 초과합니다 (${mb}MB). processAudio()로 먼저 오디오 추출·분할 후 사용하세요.`
      );
    }

    const form = new FormData();
    form.append("file", new Blob([input.data as BufferSource]), input.filename);
    // Groq가 지원하는 Whisper 모델 (한국어 지원)
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "ko");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Groq STT 실패 (HTTP ${res.status}): ${body.slice(0, 300)}`);
    }
    return groqResponseToTranscript((await res.json()) as GroqVerboseResponse);
  }
}
