import "server-only";
import { runPipeline, timedRunner, type StepRunner } from "./run";
import { pipelineSteps, recordFailure } from "./steps";
import { UserFacingError, toUserMessage } from "../errors";
import { captureError } from "../observability";

// inline 실행 (HANDOVER_QUEUE=inline — 로컬·e2e용): 같은 단계를 한 요청 안에서 순서대로
// 운영 기본은 Inngest (lib/inngest/functions.ts) — Vercel 함수 타임아웃을 단계 단위로 분산
const direct: StepRunner = (_name, fn) => fn();

export async function processVideo(videoId: string): Promise<void> {
  try {
    await runPipeline(videoId, timedRunner(direct, videoId), pipelineSteps);
  } catch (e) {
    // 내부 원인은 로그·Sentry에만, 화면·DB에는 사용자용 문구만 (스택·경로·외부 API 응답 노출 금지)
    console.error(`[pipeline] 처리 실패 (${videoId}):`, e);
    await recordFailure(videoId, toUserMessage(e));
    if (!(e instanceof UserFacingError)) await captureError(e, { videoId, queue: "inline" });
  }
}
