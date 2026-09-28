import "server-only";
import { NonRetriableError } from "inngest";
import { inngest, VIDEO_UPLOADED, type VideoUploadedData } from "./client";
import { runPipeline, timedRunner, type StepRunner } from "../pipeline/run";
import { cleanupAudioChunks, getVideoStatus, pipelineSteps, recordFailure } from "../pipeline/steps";
import { GENERIC_PIPELINE_ERROR, UserFacingError } from "../errors";
import { captureError } from "../observability";

// 영상 1개 = 함수 실행 1회, 단계마다 step.run (단계별 재시도·결과 메모이즈)
// - 사용자용 실패(플랜 한도·손상 파일 등)는 발생 지점에서 사유 기록 후 NonRetriableError → 재시도 없이 종료
// - 그 외 오류는 단계 재시도 3회 후 onFailure에서 failed + 일반 문구 + Sentry
export const processVideoFn = inngest.createFunction(
  {
    id: "process-video",
    triggers: [{ event: VIDEO_UPLOADED }],
    retries: 3,
    concurrency: { limit: 1, key: "event.data.userId" },
    idempotency: "event.data.runKey",
    // 한 HTTP 요청 = 단계 1개 (checkpointing은 여러 단계를 한 요청에 이어 붙여 maxDuration 계산이 어려워짐)
    checkpointing: false,
    onFailure: async ({ event, error }) => {
      const { videoId } = event.data.event.data as VideoUploadedData;
      const video = await getVideoStatus(videoId);
      if (video?.status === "failed" && video.error_message) {
        // 사용자용 실패(NonRetriableError)는 이미 기록됨 — 임시 청크만 확실히 정리
        await cleanupAudioChunks(video.storage_path);
        return;
      }
      await recordFailure(videoId, GENERIC_PIPELINE_ERROR);
      await captureError(error, { videoId, queue: "inngest", stage: "onFailure" });
    },
  },
  async ({ event, step }) => {
    const { videoId } = event.data as VideoUploadedData;
    const run: StepRunner = (name, fn) =>
      step.run(name, async () => {
        try {
          return await fn();
        } catch (e) {
          if (e instanceof UserFacingError) {
            await recordFailure(videoId, e.message);
            throw new NonRetriableError(e.message, { cause: e });
          }
          throw e;
        }
      }) as ReturnType<typeof fn>;
    return runPipeline(videoId, timedRunner(run, videoId), pipelineSteps);
  }
);
