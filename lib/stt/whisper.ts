import type { SttProvider, Transcript } from "./types";

// TODO(Phase 0 잔여): OpenAI API 키 확보 후 Whisper API 연동.
// - verbose_json + timestamp_granularities=segment 로 타임스탬프 포함 요청
// - 한국어: language="ko"
// 현재는 OPENAI_API_KEY 부재 → mock. 영상/오디오 검증은 .txt 트랜스크립트 입력 모드 사용.

export class WhisperStt implements SttProvider {
  async transcribe(filePath: string): Promise<Transcript> {
    throw new Error(
      `[STT mock] Whisper 연동 전입니다 (OPENAI_API_KEY 없음). ` +
        `영상 대신 트랜스크립트 .txt 파일을 입력하세요: npm run convert -- path/to/transcript.txt ` +
        `(요청 파일: ${filePath})`
    );
  }
}
