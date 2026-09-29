// 파이프라인 E2E (브라우저 없이 검증)
// 흐름: 테스트 유저 → 프로젝트 → 파일을 videos 버킷 업로드 → video 행 생성 → 변환 → done/transcripts/documents/로그 검증
// 모드:
//   npm run e2e                                   로컬 in-process (processVideo 직접 = inline 경로)
//   E2E_BASE_URL=http://localhost:3010 npm run e2e 실행 중인 앱의 /api/pipeline/start 경유 (Inngest 등 앱 설정 그대로)
//   E2E_BASE_URL=https://<배포 도메인> npm run e2e  배포 URL 대상
// 옵션: E2E_FILE=경로 (기본 samples/sample-handover.txt, mp4·webm·m4a·mov 가능), E2E_PAID=1 (20분 초과 영상용 유료 플랜 프로젝트)
//       E2E_TIMEOUT_MIN=분 (기본 20)
// 실 API: txt = 구조화+보강 질문 2회 / 영상 = STT 청크 수 + 2회
// 주의: "server-only" import 때문에 react-server 조건으로 실행 (package.json 스크립트 참고)

import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (existsSync(".env")) process.loadEnvFile(".env");

const E2E_EMAIL = "e2e@handover-test.dev";
const E2E_PASSWORD = "e2e-test-2026!";
const FILE = process.env.E2E_FILE ?? "samples/sample-handover.txt";
const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MIN ?? 20) * 60_000;

const CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY가 .env에 없습니다.");
  process.exitCode = 1;
} else {
  try {
    await main(url, serviceKey, anonKey);
  } catch (e) {
    console.error(`E2E 실패: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}

async function main(url: string, serviceKey: string, anonKey: string): Promise<void> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  console.log(`  모드: ${BASE_URL ? `앱 경유 (${BASE_URL}/api/pipeline/start)` : "로컬 in-process (inline)"} · 파일: ${FILE}`);

  // 0) 스키마 적용 여부 확인
  const { error: schemaErr } = await admin.from("projects").select("id").limit(1);
  if (schemaErr) {
    throw new Error(
      `스키마가 없습니다 (${schemaErr.message}). ` +
        `Supabase Dashboard > SQL Editor에 supabase/ALL_MIGRATIONS.sql 내용을 붙여넣고 실행한 뒤 다시 시도하세요.`
    );
  }

  // 1) 테스트 유저 (이미 있으면 재사용)
  const userId = await ensureUser(admin);
  console.log(`  유저: ${E2E_EMAIL} (${userId})`);

  // 2) 프로젝트
  const { data: project, error: pErr } = await admin
    .from("projects")
    .insert({ owner_id: userId, title: `E2E ${new Date().toISOString().slice(0, 16)}` })
    .select("id")
    .single();
  if (pErr || !project) throw new Error(`프로젝트 생성 실패: ${pErr?.message}`);
  if (process.env.E2E_PAID === "1") await admin.from("projects").update({ plan: "paid" }).eq("id", project.id);
  console.log(`  프로젝트: ${project.id}${process.env.E2E_PAID === "1" ? " (paid)" : ""}`);

  // 3) 업로드 (웹과 동일한 경로 규칙: {userId}/{projectId}/{uuid}.{ext})
  const ext = extname(FILE).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw new Error(`지원하지 않는 파일: ${FILE}`);
  const path = `${userId}/${project.id}/${randomUUID()}${ext === ".mov" ? ".mov" : ext}`;
  const { error: upErr } = await admin.storage.from("videos").upload(path, readFileSync(FILE), { contentType });
  if (upErr) throw new Error(`Storage 업로드 실패: ${upErr.message} (0002 마이그레이션 확인)`);
  console.log(`  업로드: ${path}`);

  // 4) video 행 (길이는 파이프라인이 ffmpeg로 실측해 기록)
  const { data: video, error: vErr } = await admin
    .from("videos")
    .insert({ project_id: project.id, storage_path: path, duration_seconds: null, status: "uploaded" })
    .select("id")
    .single();
  if (vErr || !video) throw new Error(`video 행 생성 실패: ${vErr?.message}`);

  // 5) 파이프라인 구동
  const started = Date.now();
  if (BASE_URL) {
    const token = await signIn(url, anonKey);
    const res = await fetch(`${BASE_URL}/api/pipeline/start`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ videoId: video.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`/api/pipeline/start ${res.status}: ${JSON.stringify(body)}`);
    console.log(`  시작 요청: ${res.status} → 상태 폴링 (최대 ${TIMEOUT_MS / 60_000}분)`);
    await pollUntilSettled(admin, video.id, started);
  } else {
    console.log(`  파이프라인 실행 중 (in-process)...`);
    const { processVideo } = await import("../lib/pipeline/process-video");
    await processVideo(video.id);
  }
  console.log(`  총 소요: ${Math.round((Date.now() - started) / 1000)}초`);

  // 6) 검증
  const { data: v } = await admin
    .from("videos")
    .select("status, error_message, duration_seconds")
    .eq("id", video.id)
    .single();
  if (v?.status !== "done") {
    throw new Error(`상태 검증 실패: status=${v?.status} error=${v?.error_message}`);
  }

  const { data: transcript } = await admin
    .from("transcripts")
    .select("id, segments")
    .eq("video_id", video.id)
    .single();
  const { data: doc } = await admin
    .from("documents")
    .select("id, content, prompt_version, enrich_questions")
    .eq("project_id", project.id)
    .single();
  const { data: logs } = await admin
    .from("ai_usage_logs")
    .select("kind, input_tokens, output_tokens")
    .eq("project_id", project.id);
  const { data: leftover } = await admin.storage.from("videos").list(`${path}.audio`);

  const segCount = Array.isArray(transcript?.segments) ? transcript.segments.length : 0;
  const qCount = Array.isArray(doc?.enrich_questions) ? doc.enrich_questions.length : 0;

  const { DocumentSchema } = await import("../lib/ai/schema");
  const parsed = DocumentSchema.safeParse(doc?.content);

  console.log(`\n=== E2E 결과`);
  console.log(`  video: done ✓ (실측 길이 ${v?.duration_seconds ?? "-"}초)`);
  console.log(`  transcript: 세그먼트 ${segCount}개 ${segCount > 0 ? "✓" : "✗"}`);
  console.log(`  document: ${doc?.id} (${doc?.prompt_version}) 스키마 ${parsed.success ? "✓" : "✗ " + parsed.error?.message}`);
  console.log(`  보강 질문: ${qCount}개 ${qCount > 0 ? "✓" : "✗"}`);
  console.log(`  ai_usage_logs: ${(logs ?? []).map((l) => l.kind).join(", ")}`);
  console.log(`  임시 오디오 청크 잔여: ${leftover?.length ?? 0}개 ${(leftover?.length ?? 0) === 0 ? "✓" : "✗"}`);
  console.log(`\n  웹 확인: npm run dev → ${E2E_EMAIL} / ${E2E_PASSWORD} 로그인 → 문서 /documents/${doc?.id}`);

  if (segCount === 0 || !parsed.success || !doc || (leftover?.length ?? 0) > 0) {
    throw new Error("검증 항목 실패 (위 ✗ 참고)");
  }
}

async function ensureUser(admin: SupabaseClient): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (created?.user) return created.user.id;
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === E2E_EMAIL);
  if (!existing) throw new Error(`테스트 유저 생성 실패: ${error?.message}`);
  return existing.id;
}

async function signIn(url: string, anonKey: string): Promise<string> {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
  if (error || !data.session) throw new Error(`테스트 유저 로그인 실패: ${error?.message}`);
  return data.session.access_token;
}

// 상태·세부 단계 변화를 시각과 함께 출력 (클라이언트 관점 단계 소요 확인용)
async function pollUntilSettled(admin: SupabaseClient, videoId: string, started: number): Promise<void> {
  let last = "";
  while (Date.now() - started < TIMEOUT_MS) {
    let { data, error } = await admin.from("videos").select("status, stage").eq("id", videoId).single();
    if (error) {
      // stage 컬럼(0009) 미적용 — status만
      ({ data, error } = await admin.from("videos").select("status").eq("id", videoId).single());
    }
    const current = !data ? "" : `${data.status}${data.stage ? ` (${data.stage})` : ""}`;
    if (current && current !== last) {
      console.log(`    +${Math.round((Date.now() - started) / 1000)}초 ${current}`);
      last = current;
    }
    if (data?.status === "done" || data?.status === "failed") return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`시간 초과 (${TIMEOUT_MS / 60_000}분)`);
}
