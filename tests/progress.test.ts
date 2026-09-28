import { describe, it, expect } from "vitest";
import { describeProgress, nextPollDelay, POLL_MAX_MS, POLL_MIN_MS } from "../lib/pipeline/progress";

const states = (p: ReturnType<typeof describeProgress>) => p.steps.map((s) => s.state);
const base = { stage: null, durationSeconds: 600, isText: false };

describe("describeProgress", () => {
  it("업로드됨 → 대기", () => {
    const p = describeProgress({ ...base, status: "uploaded" });
    expect(states(p)).toEqual(["active", "pending", "pending", "pending"]);
    expect(p.detail).toBe("변환 대기 중");
  });

  it("음성 인식 중 + 청크 진행률", () => {
    const p = describeProgress({ ...base, status: "transcribing", stage: "stt:2/3" });
    expect(states(p)).toEqual(["done", "active", "pending", "pending"]);
    expect(p.detail).toBe("음성 인식 2/3");
    expect(p.eta).toMatch(/남음$/);
  });

  it("구조화 중 / 보강 질문 중 (stage로 구분)", () => {
    expect(states(describeProgress({ ...base, status: "structuring", stage: "structuring" }))).toEqual([
      "done", "done", "active", "pending",
    ]);
    expect(states(describeProgress({ ...base, status: "structuring", stage: "enriching" }))).toEqual([
      "done", "done", "done", "active",
    ]);
  });

  it("stage 컬럼이 없어도(null) status만으로 표시 — 0009 미적용 배포 대비", () => {
    expect(states(describeProgress({ ...base, status: "transcribing" }))).toEqual(["done", "active", "pending", "pending"]);
    expect(states(describeProgress({ ...base, status: "structuring" }))).toEqual(["done", "done", "active", "pending"]);
  });

  it("실패 지점 표시 — stage 기준, 없으면 업로드만 완료", () => {
    expect(states(describeProgress({ ...base, status: "failed", stage: "stt:1/3" }))).toEqual([
      "done", "failed", "pending", "pending",
    ]);
    expect(states(describeProgress({ ...base, status: "failed", stage: "structuring" }))).toEqual([
      "done", "done", "failed", "pending",
    ]);
    expect(states(describeProgress({ ...base, status: "failed" }))).toEqual(["done", "pending", "pending", "pending"]);
  });

  it("txt는 음성 인식 세부 표시 없음, 완료는 전부 done·예상 시간 없음", () => {
    expect(describeProgress({ ...base, isText: true, status: "transcribing" }).detail).toBeNull();
    const done = describeProgress({ ...base, status: "done" });
    expect(states(done)).toEqual(["done", "done", "done", "done"]);
    expect(done.eta).toBeNull();
  });

  it("긴 영상일수록 예상 시간이 길다", () => {
    const short = describeProgress({ ...base, status: "transcribing", durationSeconds: 60 }).eta!;
    const long = describeProgress({ ...base, status: "transcribing", durationSeconds: 3600 }).eta!;
    const minutes = (s: string) => (s.startsWith("1분") ? 1 : Number(s.match(/약 (\d+)분/)![1]));
    expect(minutes(long)).toBeGreaterThan(minutes(short));
  });
});

describe("nextPollDelay", () => {
  it("변화 없으면 1.5배씩 최대 15초, 변화 있으면 3초로 리셋", () => {
    let d = POLL_MIN_MS;
    const seq: number[] = [];
    for (let i = 0; i < 6; i++) seq.push((d = nextPollDelay(d, false)));
    expect(seq).toEqual([4500, 6750, 10125, 15000, 15000, 15000]);
    expect(seq.at(-1)).toBe(POLL_MAX_MS);
    expect(nextPollDelay(15000, true)).toBe(POLL_MIN_MS);
  });
});
