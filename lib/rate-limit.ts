import "server-only";
import { createAdminClient } from "./supabase/admin";
import { rateLimitFor, type RateLimitAction } from "./rate-limit-config";

// 사용자별 AI 호출 레이트리밋 (고정 1시간 윈도우, rate_limits 테이블 — 0007 마이그레이션)
// 반환: null = 허용, string = 사용자 안내 문구
export async function checkRateLimit(userId: string, action: RateLimitAction): Promise<string | null> {
  const { limit, message } = rateLimitFor(action);
  const { data, error } = await createAdminClient().rpc("increment_rate_limit", {
    p_user: userId,
    p_action: action,
    p_window_seconds: 3600,
  });
  if (error) {
    // 마이그레이션 미적용 등 인프라 오류로 서비스 전체를 막지 않음 (fail-open) — 로그로 감지
    console.error(`[rate-limit] 카운터 실패 (허용 처리): ${error.message}`);
    return null;
  }
  return (data as number) > limit ? message : null;
}
