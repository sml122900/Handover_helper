import { describe, it, expect } from "vitest";
import { matchKeyframesToSteps, MATCH_WINDOW_SECONDS } from "../lib/keyframes/match";

const kf = (id: string, t: number) => ({ id, timestampSeconds: t });

describe("matchKeyframesToSteps", () => {
  it("가장 가까운 키프레임 매칭", () => {
    const m = matchKeyframesToSteps(
      [
        { step: 1, startSeconds: 10 },
        { step: 2, startSeconds: 100 },
      ],
      [kf("a", 12), kf("b", 95)]
    );
    expect(m.get(1)).toBe("a");
    expect(m.get(2)).toBe("b");
  });

  it("범위(90초) 밖이면 null", () => {
    const m = matchKeyframesToSteps(
      [{ step: 1, startSeconds: 0 }],
      [kf("far", MATCH_WINDOW_SECONDS + 1)]
    );
    expect(m.get(1)).toBeNull();
  });

  it("범위 경계값은 매칭", () => {
    const m = matchKeyframesToSteps(
      [{ step: 1, startSeconds: 0 }],
      [kf("edge", MATCH_WINDOW_SECONDS)]
    );
    expect(m.get(1)).toBe("edge");
  });

  it("타임스탬프 없는 단계는 null", () => {
    const m = matchKeyframesToSteps([{ step: 1, startSeconds: null }], [kf("a", 0)]);
    expect(m.get(1)).toBeNull();
  });

  it("키프레임이 없으면 전부 null", () => {
    const m = matchKeyframesToSteps([{ step: 1, startSeconds: 5 }], []);
    expect(m.get(1)).toBeNull();
  });

  it("같은 키프레임이 여러 단계에 매칭될 수 있음", () => {
    const m = matchKeyframesToSteps(
      [
        { step: 1, startSeconds: 10 },
        { step: 2, startSeconds: 20 },
      ],
      [kf("only", 15)]
    );
    expect(m.get(1)).toBe("only");
    expect(m.get(2)).toBe("only");
  });
});
