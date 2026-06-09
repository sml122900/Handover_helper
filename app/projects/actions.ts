"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 200) {
    redirect("/projects?error=title");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("projects")
    .insert({ title, owner_id: user.id })
    .select("id")
    .single();
  if (error || !data) {
    redirect("/projects?error=create");
  }

  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}
