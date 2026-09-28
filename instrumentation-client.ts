// 브라우저 오류 → Sentry (NEXT_PUBLIC_SENTRY_DSN 있을 때만 SDK 로드 — 없으면 번들 영향 최소)
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("@sentry/nextjs").then((Sentry) =>
    Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0 })
  );
}
