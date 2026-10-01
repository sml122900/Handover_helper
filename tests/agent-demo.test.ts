import { describe, expect, it } from "vitest";
import { AskSchema, cleanSnippet, ConfirmSchema, isNotInDocLine, parseLine } from "../lib/agent-demo";

describe("에이전트 질문 화면 — 답변 파싱", () => {
  it("[근거 n]·**굵게**·[확인 필요]를 조각으로 나눈다", () => {
    expect(parseLine("**뒤쪽부터** 채워요. [근거 1][근거 3] [확인 필요]")).toEqual([
      { kind: "bold", text: "뒤쪽부터" },
      { kind: "text", text: " 채워요. " },
      { kind: "cite", n: 1 },
      { kind: "cite", n: 3 },
      { kind: "text", text: " " },
      { kind: "check" },
    ]);
    expect(parseLine("근거 없는 줄")).toEqual([{ kind: "text", text: "근거 없는 줄" }]);
  });

  it("근거 조각의 마크다운 표시만 걷어 낸다", () => {
    expect(cleanSnippet("3. **홀케이크 폐기** _(영상 2:48~3:39)_\n   만든 날 포함")).toBe(
      "3. 홀케이크 폐기 (영상 2:48~3:39)\n   만든 날 포함",
    );
    expect(cleanSnippet("57)_\n   새벽 2시에 음료가 입고된다.")).toBe("   새벽 2시에 음료가 입고된다.");
  });

  it("부분 답변의 '문서에 없어요' 문장을 구분한다", () => {
    expect(isNotInDocLine("1,000원 미만 차이일 때 어떻게 하는지는 문서에 없어요.")).toBe(true);
    expect(isNotInDocLine("매장 단톡방에 올려 주세요. [근거 1]")).toBe(false);
  });
});

describe("에이전트 질문 화면 — 프록시 입력 검증", () => {
  it("매장·질문·시각 형식을 검증한다", () => {
    expect(AskSchema.safeParse({ store_id: "s1", question: "질문", current_time: "21:35" }).success).toBe(true);
    expect(AskSchema.safeParse({ store_id: "s9", question: "질문" }).success).toBe(false);
    expect(AskSchema.safeParse({ store_id: "s1", question: "  " }).success).toBe(false);
    expect(AskSchema.safeParse({ store_id: "s1", question: "질문", current_time: "25:00" }).success).toBe(false);
    expect(ConfirmSchema.safeParse({ thread_id: "abc", approve: true, reason: "유통기한 경과" }).success).toBe(true);
    expect(ConfirmSchema.safeParse({ thread_id: "", approve: true }).success).toBe(false);
  });
});
