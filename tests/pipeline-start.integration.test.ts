// startPipeline 통합 테스트 — 실제 Supabase 대상, env 없으면 skip. /api/pipeline/start·completeUpload 공용 함수
// 실행: npm run test:integration (임시 유저 2명 → 테스트 → 삭제). 큐 전송(inngest.send)만 mock — AI·STT 호출 없음
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));
const send = vi.fn(async () => ({ ids: ["evt"] }));
vi.mock("../lib/inngest/client", () => ({ inngest: { send }, VIDEO_UPLOADED: "video/uploaded" }));

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL && ANON && SERVICE);

describe.skipIf(!enabled)("startPipeline: 소유권·재검증", () => {
  let admin: SupabaseClient;
  const users: { id: string; client: SupabaseClient }[] = [];
  let videoId = "";
  let path = "";

  async function signedIn() {
    const email = `pipeline-test-${randomUUID()}@example.com`;
    const password = randomUUID();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error;
    const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email, password });
    users.push({ id: data.user.id, client });
    return users.at(-1)!;
  }

  beforeAll(async () => {
    process.env.HANDOVER_QUEUE = "inngest";
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const a = await signedIn();
    await signedIn();
    const { data: project } = await admin
      .from("projects")
      .insert({ owner_id: a.id, title: "pipeline start 테스트" })
      .select("id")
      .single();
    path = `${a.id}/${project!.id}/${randomUUID()}.txt`;
    await admin.storage.from("videos").upload(path, new Blob(["[00:00] 테스트 트랜스크립트"]), { contentType: "text/plain" });
    const { data: video } = await admin
      .from("videos")
      .insert({ project_id: project!.id, storage_path: path, status: "uploaded" })
      .select("id")
      .single();
    videoId = video!.id;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.storage.from("videos").remove([path]);
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it("다른 사용자의 videoId로는 시작할 수 없다 (큐 전송 없음, 상태 불변)", async () => {
    const [, b] = users;
    const { startPipeline } = await import("../lib/pipeline/start");
    const result = await startPipeline(b.client, b.id, videoId);
    expect(result).toEqual({ ok: false, error: "영상을 찾을 수 없습니다." });
    expect(send).not.toHaveBeenCalled();
    const { data } = await admin.from("videos").select("status").eq("id", videoId).single();
    expect(data?.status).toBe("uploaded");
  });

  it("소유자는 시작 가능 — 매직 넘버 재검증 통과 후 최초 실행 키로 이벤트 1개", async () => {
    const [a] = users;
    const { startPipeline } = await import("../lib/pipeline/start");
    const result = await startPipeline(a.client, a.id, videoId);
    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      name: "video/uploaded",
      data: { videoId, userId: a.id, runKey: `${videoId}:initial` },
    });
  });
});
