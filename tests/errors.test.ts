import { describe, it, expect } from "vitest";
import { UserFacingError, toUserMessage, GENERIC_PIPELINE_ERROR } from "../lib/errors";

describe("toUserMessage", () => {
  it("UserFacingError는 그대로", () => {
    expect(toUserMessage(new UserFacingError("영상 파일을 읽을 수 없습니다."))).toBe("영상 파일을 읽을 수 없습니다.");
  });
  it("내부 에러(경로·외부 API 응답)는 일반 문구로", () => {
    expect(toUserMessage(new Error("Command failed: C:\tmp\ffmpeg.exe -i input.mp4"))).toBe(GENERIC_PIPELINE_ERROR);
    expect(toUserMessage(new Error('구조화 실패: 400 {"type":"error"}'))).toBe(GENERIC_PIPELINE_ERROR);
    expect(toUserMessage("string")).toBe(GENERIC_PIPELINE_ERROR);
  });
  it("비용 가드 안내는 통과", () => {
    const msg = "비용 가드: 트랜스크립트가 너무 깁니다 (130000자 > 120000자). 분할해서 입력하세요.";
    expect(toUserMessage(new Error(msg))).toBe(msg);
  });
});
