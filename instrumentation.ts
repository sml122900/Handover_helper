import type { Instrumentation } from "next";

// 서버 부팅 훅 — env 검증 (Node 런타임 전용 모듈로 분리: Edge 번들에 process.exit 포함 방지) + Sentry(DSN 있을 때만)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./lib/env-check");
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
  }
}

// 서버 컴포넌트·라우트 핸들러의 처리되지 않은 오류 → Sentry
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== "nodejs") return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
