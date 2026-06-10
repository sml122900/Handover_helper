import { describe, it, expect } from "vitest";
import { whisperResponseToTranscript, WhisperStt, WHISPER_MAX_BYTES } from "../lib/stt/whisper";
import { MockStt } from "../lib/stt/mock";
import { getSttProvider } from "../lib/stt";

describe("whisperResponseToTranscript", () => {
  it("세그먼트를 타임스탬프 포함으로 매핑한다", () => {
    const t = whisperResponseToTranscript({
      language: "korean",
      segments: [
        { start: 0, end: 4.2, text: " 안녕하세요. " },
        { start: 4.2, end: 9.8, text: "오늘은 인수인계입니다." },
      ],
    });
    expect(t.source).toBe("whisper");
    expect(t.segments).toEqual([
      { start: 0, end: 4.2, text: "안녕하세요." },
      { start: 4.2, end: 9.8, text: "오늘은 인수인계입니다." },
    ]);
  });

  it("빈 텍스트 세그먼트는 제거한다", () => {
    const t = whisperResponseToTranscript({
      segments: [
        { start: 0, end: 1, text: "  " },
        { start: 1, end: 2, text: "내용" },
      ],
    });
    expect(t.segments).toHaveLength(1);
  });

  it("세그먼트 없이 text만 오면 타임스탬프 null 단일 세그먼트", () => {
    const t = whisperResponseToTranscript({ text: "전체 텍스트" });
    expect(t.segments).toEqual([{ start: null, end: null, text: "전체 텍스트" }]);
  });

  it("세그먼트도 text도 없으면 빈 배열 (지어내지 않음)", () => {
    expect(whisperResponseToTranscript({}).segments).toEqual([]);
  });
});

describe("WhisperStt 가드", () => {
  it("API 키 없으면 한국어 안내 에러", async () => {
    const stt = new WhisperStt(undefined);
    await expect(stt.transcribe({ data: new Uint8Array(10), filename: "a.mp4" })).rejects.toThrow(
      /OPENAI_API_KEY/
    );
  });

  it("25MB 초과 파일 거부 (API 호출 전)", async () => {
    const stt = new WhisperStt("sk-test");
    const big = new Uint8Array(WHISPER_MAX_BYTES + 1);
    await expect(stt.transcribe({ data: big, filename: "big.mp4" })).rejects.toThrow(/25MB/);
  });
});

describe("getSttProvider (env 전환)", () => {
  it("HANDOVER_STT=mock → MockStt", () => {
    expect(getSttProvider({ HANDOVER_STT: "mock", OPENAI_API_KEY: "sk-x" })).toBeInstanceOf(MockStt);
  });
  it("HANDOVER_STT=whisper → WhisperStt", () => {
    expect(getSttProvider({ HANDOVER_STT: "whisper" })).toBeInstanceOf(WhisperStt);
  });
  it("미설정 + 키 있음 → WhisperStt", () => {
    expect(getSttProvider({ OPENAI_API_KEY: "sk-x" })).toBeInstanceOf(WhisperStt);
  });
  it("미설정 + 키 없음 → MockStt", () => {
    expect(getSttProvider({})).toBeInstanceOf(MockStt);
  });
  it("알 수 없는 값 → 에러", () => {
    expect(() => getSttProvider({ HANDOVER_STT: "papago" })).toThrow(/HANDOVER_STT/);
  });
});
