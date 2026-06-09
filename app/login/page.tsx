import { supabaseConfigured } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  if (!supabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-6 text-sm text-amber-200">
          <p className="mb-2 font-semibold">Supabase 셋업 필요</p>
          <p>
            새 Supabase 프로젝트를 만들고 <code>.env</code>에{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> / <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>를
            설정한 뒤, <code>supabase/migrations/</code>의 SQL을 적용하세요. (PROGRESS.md 참고)
          </p>
        </div>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-8 text-center text-2xl font-bold text-white">Handover 로그인</h1>
      <LoginForm />
    </main>
  );
}
