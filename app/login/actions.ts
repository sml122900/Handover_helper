"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null; notice?: string | null };

function readCredentials(formData: FormData): { email: string; password: string } | string {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !email.includes("@")) return "올바른 이메일을 입력하세요.";
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  return { email, password };
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const cred = readCredentials(formData);
  if (typeof cred === "string") return { error: cred };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(cred);
  if (error) {
    return { error: "로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요." };
  }
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const cred = readCredentials(formData);
  if (typeof cred === "string") return { error: cred };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(cred);
  if (error) {
    return { error: "가입에 실패했습니다. 잠시 후 다시 시도하세요." };
  }
  if (data.user && !data.session) {
    return { error: null, notice: "확인 이메일을 보냈습니다. 메일함에서 인증 후 로그인하세요." };
  }
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
