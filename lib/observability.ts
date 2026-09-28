// Sentry 전송 (SENTRY_DSN 없으면 아무것도 안 함 — 로컬·CI·미설정 배포 안전)
// 동적 import: DSN이 없으면 SDK를 불러오지 않음
export async function captureError(error: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, { extra: context });
    await Sentry.flush(2000); // 서버리스 종료 전 전송 보장
  } catch (e) {
    console.error("[observability] Sentry 전송 실패:", e);
  }
}
