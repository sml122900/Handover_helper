"use client";

import { useActionState, useState } from "react";
import { login, signup, type AuthState } from "./actions";

const initialState: AuthState = { error: null };

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const action = mode === "login" ? login : signup;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
        이메일
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-md border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-sub)] focus:border-[var(--text-sub)] focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
        비밀번호 (8자 이상)
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="rounded-md border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-sub)] focus:border-[var(--text-sub)] focus:outline-none"
        />
      </label>

      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state.notice && <p className="text-sm text-emerald-400">{state.notice}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--text)] py-2 font-medium text-[var(--bg)] hover:opacity-80 disabled:opacity-50"
      >
        {pending ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="text-sm text-[var(--text-sub)] underline hover:text-[var(--text)]"
      >
        {mode === "login" ? "계정이 없나요? 가입하기" : "이미 계정이 있나요? 로그인"}
      </button>
    </form>
  );
}
