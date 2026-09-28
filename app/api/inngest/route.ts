import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { processVideoFn } from "@/lib/inngest/functions";

// Inngest가 단계마다 이 엔드포인트를 호출 — 요청 1회 = 단계 1개 (checkpointing 끔)
// Vercel Hobby는 Fluid Compute 활성 시 최대 300초 (비활성 60초) — PROGRESS.md 사용자 할 일
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions: [processVideoFn] });
