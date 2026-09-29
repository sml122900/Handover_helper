// 화면 녹화 용량 관리 (순수 로직 — vitest 대상). 한도는 videos 버킷 500MB와 동일.
import { MAX_UPLOAD_BYTES } from "./upload-validate";

// 비트레이트: 1080p 이하 화면 녹화에서 글씨가 읽히는 수준(VP9)을 기준으로 잡은 목표값
export const VIDEO_BITS_PER_SECOND = 1_500_000;
export const AUDIO_BITS_PER_SECOND = 64_000;

export const WARN_RATIO = 0.8; // 한도의 80%에서 경고
export const STOP_RATIO = 0.95; // 한도의 95%에서 자동 정지 (마지막 청크·오버슈트 여유)

/** 비트레이트 × 시간 = 예상 용량(바이트) */
export function estimateBytes(seconds: number): number {
  return Math.round(((VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND) * seconds) / 8);
}

export type RecordingLevel = "ok" | "warn" | "stop";

export function evaluateRecording(totalBytes: number, limit = MAX_UPLOAD_BYTES): RecordingLevel {
  if (totalBytes >= limit * STOP_RATIO) return "stop";
  if (totalBytes >= limit * WARN_RATIO) return "warn";
  return "ok";
}
