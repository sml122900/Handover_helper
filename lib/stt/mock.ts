import type { SttInput, SttProvider, Transcript } from "./types";

// mock STT — 가짜 트랜스크립트를 만들지 않고 명시적 실패 (환각 금지 원칙)
export class MockStt implements SttProvider {
  async transcribe(input: SttInput): Promise<Transcript> {
    throw new Error(
      `[STT mock] STT가 비활성 상태입니다 (HANDOVER_STT=mock 또는 OPENAI_API_KEY 없음). ` +
        `영상 대신 트랜스크립트 .txt 파일을 입력하세요. (요청 파일: ${input.filename})`
    );
  }
}
