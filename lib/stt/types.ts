// STT 인터페이스 — 추후 Whisper/국내 STT 교체 가능하도록 분리

export interface TranscriptSegment {
  /** 구간 시작 (초). 타임스탬프 없는 입력이면 null */
  start: number | null;
  /** 구간 끝 (초). 알 수 없으면 null */
  end: number | null;
  text: string;
}

export interface Transcript {
  segments: TranscriptSegment[];
  language: string;
  source: "whisper" | "text-file" | "mock";
}

export interface SttProvider {
  transcribe(filePath: string): Promise<Transcript>;
}
