import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Bearer 액세스 토큰(API 라우트 호출자)으로 사용자 세션 클라이언트 생성 — RLS가 그 사용자 기준으로 적용됨
export function createClientForToken(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase 환경변수가 없습니다.");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
