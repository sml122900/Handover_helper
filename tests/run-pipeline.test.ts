import { describe, it, expect, vi } from "vitest";
import { runPipeline, runKeyFor, timedRunner, type PipelineContext, type PipelineSteps, type StepRunner } from "../lib/pipeline/run";

const baseCtx: PipelineContext = {
  videoId: "v1",
  projectId: "p1",
  ownerId: "u1",
  plan: "free",
  storagePath: "u1/p1/x.mp4",
  isText: false,
  hasTranscript: false,
  hasKeyframes: false,
};

// 모든 단계 mock — 호출된 step 이름을 순서대로 기록 (API·DB·ffmpeg 없음)
function setup(ctx: PipelineContext | null, overrides: Partial<PipelineSteps> = {}) {
  const calls: string[] = [];
  const steps: PipelineSteps = {
    prepare: vi.fn(async () => ctx),
    saveTextTranscript: vi.fn(async () => {}),
    extractAudio: vi.fn(async () => [
      { path: "a/chunk_000.mp3", offsetSeconds: 0 },
      { path: "a/chunk_001.mp3", offsetSeconds: 600 },
      { path: "a/chunk_002.mp3", offsetSeconds: 1200 },
    ]),
    transcribeChunk: vi.fn(async (_c, chunk) => ({
      segments: [{ start: chunk.offsetSeconds, end: null, text: "t" }],
      language: "ko",
      source: "groq" as const,
    })),
    saveTranscript: vi.fn(async () => {}),
    extractKeyframes: vi.fn(async () => {}),
    structure: vi.fn(async () => ({ documentId: "d1" })),
    matchKeyframes: vi.fn(async () => {}),
    enrich: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    ...overrides,
  };
  const run: StepRunner = (name, fn) => {
    calls.push(name);
    return fn();
  };
  return { steps, run, calls };
}

describe("runPipeline", () => {
  it("영상: 오디오 추출 → 청크별 STT(청크마다 step) → 저장 → 키프레임 → 구조화 → 매칭 → 보강 → 완료", async () => {
    const { steps, run, calls } = setup(baseCtx);
    expect(await runPipeline("v1", run, steps)).toBe("done");
    expect(calls).toEqual([
      "prepare", "extract-audio", "stt-1", "stt-2", "stt-3", "save-transcript",
      "keyframes", "structure", "match-keyframes", "enrich", "finish",
    ]);
    // 청크 결과가 순서대로 저장 단계에 전달
    const parts = vi.mocked(steps.saveTranscript).mock.calls[0][1];
    expect(parts.map((p) => p.segments[0].start)).toEqual([0, 600, 1200]);
    expect(steps.enrich).toHaveBeenCalledWith(baseCtx, "d1");
  });

  it("txt: STT·키프레임 없이 트랜스크립트 저장 → 구조화 → 보강", async () => {
    const { steps, run, calls } = setup({ ...baseCtx, isText: true, storagePath: "u1/p1/x.txt" });
    await runPipeline("v1", run, steps);
    expect(calls).toEqual(["prepare", "save-transcript", "structure", "enrich", "finish"]);
    expect(steps.extractAudio).not.toHaveBeenCalled();
  });

  it("재시도: 트랜스크립트가 있으면 STT를 건너뛰고 구조화부터 (재과금 없음)", async () => {
    const { steps, run, calls } = setup({ ...baseCtx, hasTranscript: true, hasKeyframes: true });
    await runPipeline("v1", run, steps);
    expect(calls).toEqual(["prepare", "structure", "match-keyframes", "enrich", "finish"]);
    expect(steps.extractAudio).not.toHaveBeenCalled();
    expect(steps.transcribeChunk).not.toHaveBeenCalled();
    expect(steps.extractKeyframes).not.toHaveBeenCalled();
  });

  it("처리 대상이 아니면(prepare=null) 아무 단계도 실행하지 않음", async () => {
    const { steps, run, calls } = setup(null);
    expect(await runPipeline("v1", run, steps)).toBe("skipped");
    expect(calls).toEqual(["prepare"]);
  });

  it("단계 실패는 호출자에게 전파되고 이후 단계는 실행되지 않음", async () => {
    const { steps, run, calls } = setup(baseCtx, {
      structure: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(runPipeline("v1", run, steps)).rejects.toThrow("boom");
    expect(calls.at(-1)).toBe("structure");
    expect(steps.enrich).not.toHaveBeenCalled();
    expect(steps.finish).not.toHaveBeenCalled();
  });
});

describe("timedRunner", () => {
  it("결과를 그대로 넘기고 단계 소요 시간을 로그", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = timedRunner((_n, fn) => fn(), "v1");
    expect(await run("structure", async () => 42)).toBe(42);
    expect(log.mock.calls[0][0]).toMatch(/^\[pipeline-timing\] .*"step":"structure"/);
    log.mockRestore();
  });
});

describe("runKeyFor", () => {
  it("최초 업로드는 영상당 고정 키 (중복 이벤트 차단), 재시도는 매번 새 키", () => {
    expect(runKeyFor("v1", "initial")).toBe("v1:initial");
    expect(runKeyFor("v1", "initial")).toBe(runKeyFor("v1", "initial"));
    expect(runKeyFor("v1", "retry", 1)).not.toBe(runKeyFor("v1", "retry", 2));
    expect(runKeyFor("v1", "retry", 1)).not.toBe(runKeyFor("v1", "initial"));
  });
});
