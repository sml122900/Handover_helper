// RLS·권한 통합 테스트 — 실제 Supabase 대상. env 없으면 skip (CI·npm test 기본 skip)
// 실행: npm run test:rls  (.env 로드, 임시 유저 2명 생성 → 테스트 → 삭제)
// 0008_rls_hardening.sql 미적용이면 "service_role 전용 쓰기" 케이스가 실패한다 (의도된 신호)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL && ANON && SERVICE);

describe.skipIf(!enabled)("RLS: 다른 사용자 데이터 접근 차단", () => {
  let admin: SupabaseClient;
  let a: SupabaseClient; // 소유자
  let b: SupabaseClient; // 공격자
  const userIds: string[] = [];
  const ids = {} as Record<"project" | "video" | "document" | "keyframe" | "share", string>;
  let videoPath = "";

  async function signedInClient(): Promise<{ client: SupabaseClient; id: string }> {
    const email = `rls-test-${randomUUID()}@example.com`;
    const password = randomUUID();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error;
    userIds.push(data.user.id);
    const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error: sErr } = await client.auth.signInWithPassword({ email, password });
    if (sErr) throw sErr;
    return { client, id: data.user.id };
  }

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const ua = await signedInClient();
    const ub = await signedInClient();
    a = ua.client;
    b = ub.client;

    const one = async (table: string, row: Record<string, unknown>) => {
      const { data, error } = await admin.from(table).insert(row).select("id").single();
      if (error || !data) throw new Error(`${table} seed 실패: ${error?.message}`);
      return data.id as string;
    };
    ids.project = await one("projects", { owner_id: ua.id, title: "RLS 테스트" });
    videoPath = `${ua.id}/${ids.project}/${randomUUID()}.txt`;
    await admin.storage.from("videos").upload(videoPath, new Blob(["[00:00] 테스트"]), { contentType: "text/plain" });
    ids.video = await one("videos", { project_id: ids.project, storage_path: videoPath, status: "done" });
    ids.document = await one("documents", { project_id: ids.project, content: {}, prompt_version: "test" });
    ids.keyframe = await one("keyframes", {
      video_id: ids.video,
      timestamp_seconds: 1,
      image_path: `${ua.id}/x.jpg`,
    });
    ids.share = await one("share_links", { document_id: ids.document, token: randomUUID() + randomUUID() });
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.storage.from("videos").remove([videoPath]);
    for (const id of userIds) await admin.auth.admin.deleteUser(id); // projects 등 cascade
  }, 60_000);

  it.each([
    ["projects", "project"],
    ["videos", "video"],
    ["documents", "document"],
    ["keyframes", "keyframe"],
    ["share_links", "share"],
  ] as const)("B는 A의 %s를 조회할 수 없다", async (table, key) => {
    const { data } = await b.from(table).select("id").eq("id", ids[key]);
    expect(data ?? []).toHaveLength(0);
  });

  it("B는 A의 transcripts·ai_usage_logs·payments를 볼 수 없다", async () => {
    for (const table of ["transcripts", "ai_usage_logs", "payments"]) {
      const { data } = await b.from(table).select("id");
      expect(data ?? [], table).toHaveLength(0);
    }
  });

  it("B의 update·delete는 A의 행에 영향 없음", async () => {
    await b.from("projects").update({ title: "탈취" }).eq("id", ids.project);
    await b.from("documents").update({ content_html: "<p>탈취</p>" }).eq("id", ids.document);
    await b.from("share_links").delete().eq("id", ids.share);
    await b.from("projects").delete().eq("id", ids.project);

    const { data: p } = await admin.from("projects").select("title").eq("id", ids.project).single();
    const { data: d } = await admin.from("documents").select("content_html").eq("id", ids.document).single();
    const { data: s } = await admin.from("share_links").select("id").eq("id", ids.share);
    expect(p?.title).toBe("RLS 테스트");
    expect(d?.content_html).toBeNull();
    expect(s).toHaveLength(1);
  });

  it("B는 A의 Storage 영상을 다운로드할 수 없다", async () => {
    const { data } = await b.storage.from("videos").download(videoPath);
    expect(data).toBeNull();
  });

  // ── 0008: 본인 행이라도 service_role 전용 컬럼·테이블은 쓰기 불가 ──
  it("A는 자기 프로젝트 plan을 paid로 바꿀 수 없다 (결제 우회)", async () => {
    await a.from("projects").update({ plan: "paid" }).eq("id", ids.project);
    const { data } = await admin.from("projects").select("plan").eq("id", ids.project).single();
    expect(data?.plan).toBe("free");
  });

  it("A는 paid 프로젝트를 직접 생성할 수 없다", async () => {
    const { data: u } = await a.auth.getUser();
    const { error } = await a.from("projects").insert({ owner_id: u.user!.id, title: "x", plan: "paid" });
    expect(error).not.toBeNull();
  });

  it("A는 videos.storage_path·status를 조작할 수 없다", async () => {
    await a.from("videos").update({ storage_path: "other/path.mp4", status: "uploaded" }).eq("id", ids.video);
    const { data } = await admin.from("videos").select("storage_path, status").eq("id", ids.video).single();
    expect(data).toEqual({ storage_path: videoPath, status: "done" });
  });

  it("A는 videos.stage를 수정할 수 없다 (0009 — 파이프라인 전용 컬럼)", async () => {
    await a.from("videos").update({ stage: "enriching" }).eq("id", ids.video);
    const { data, error } = await admin.from("videos").select("stage").eq("id", ids.video).single();
    expect(error, "0009_video_stage.sql 적용 필요").toBeNull();
    expect(data?.stage).toBeNull();
  });

  it("A는 videos.status_changed_at을 수정할 수 없다 (0011 — 멈춤 감지 기준 시각)", async () => {
    const { data: before, error: e1 } = await admin.from("videos").select("status_changed_at").eq("id", ids.video).single();
    expect(e1, "0011_video_status_changed_at.sql 적용 필요").toBeNull();
    await a.from("videos").update({ status_changed_at: "2000-01-01T00:00:00Z" }).eq("id", ids.video);
    const { data: after } = await admin.from("videos").select("status_changed_at").eq("id", ids.video).single();
    expect(after?.status_changed_at).toBe(before?.status_changed_at);
  });

  it("A는 keyframes·transcripts·videos를 직접 insert할 수 없다", async () => {
    const kf = await a.from("keyframes").insert({ video_id: ids.video, timestamp_seconds: 2, image_path: "victim/x.jpg" });
    const tr = await a.from("transcripts").insert({ video_id: ids.video, segments: [] });
    const vd = await a.from("videos").insert({ project_id: ids.project, storage_path: "victim/x.mp4" });
    expect(kf.error).not.toBeNull();
    expect(tr.error).not.toBeNull();
    expect(vd.error).not.toBeNull();
  });

  it("A는 자기 문서 편집 컬럼(content_html)은 수정할 수 있다", async () => {
    const { error } = await a.from("documents").update({ content_html: "<p>편집</p>" }).eq("id", ids.document);
    expect(error).toBeNull();
  });

  it("사용자는 레이트리밋 RPC를 직접 호출할 수 없다", async () => {
    const { data: u } = await a.auth.getUser();
    const { error } = await a.rpc("increment_rate_limit", {
      p_user: u.user!.id,
      p_action: "pipeline",
      p_window_seconds: 3600,
    });
    expect(error).not.toBeNull();
  });
});
