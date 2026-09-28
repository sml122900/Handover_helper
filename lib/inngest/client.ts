import { Inngest } from "inngest";

// 로컬: INNGEST_DEV=1 + `npx inngest-cli@latest dev -u http://localhost:3010/api/inngest`
// 운영: Vercel Inngest Integration이 INNGEST_EVENT_KEY·INNGEST_SIGNING_KEY 주입
export const inngest = new Inngest({ id: "handover" });

export interface VideoUploadedData {
  videoId: string;
  userId: string;
  /** idempotency 키 — lib/pipeline/run.ts runKeyFor */
  runKey: string;
}

export const VIDEO_UPLOADED = "video/uploaded";
