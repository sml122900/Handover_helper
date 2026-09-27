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
  source: "whisper" | "groq" | "text-file" | "mock";
}

export interface SttInput {
  /** 미디어 파일 바이트 (CLI: 파일 읽기, 파이프라인: Storage 다운로드) */
  data: Uint8Array;
  /** 확장자 포함 파일명 — Whisper가 포맷 판별에 사용 */
  filename: string;
}

export interface SttProvider {
  transcribe(input: SttInput): Promise<Transcript>;
}
