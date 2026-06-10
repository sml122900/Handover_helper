// txt 업로드 E2E (웹 파이프라인을 코드로 구동 — 브라우저 없이 검증)
// 흐름: 테스트 유저 → 프로젝트 → samples/sample-handover.txt를 videos 버킷 업로드
//       → video 행 생성 → processVideo() 직접 호출 → done/transcripts/documents/로그 검증
// 사용법: npm run e2e   (실 Claude API 2회: 구조화 + 보강 질문)
// 주의: "server-only" import 때문에 react-server 조건으로 실행해야 함 (package.json 스크립트 참고)

import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env")) process.loadEnvFile(".env");

const E2E_EMAIL = "e2e@handover-test.dev";
const E2E_PASSWORD = "e2e-test-2026!";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env에 없습니다.");
  process.exitCode = 1;
} else {
  try {
    await main(url, serviceKey);
  } catch (e) {
    console.error(`E2E 실패: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}

async function main(url: string, serviceKey: string): Promise<void> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 0) 스키마 적용 여부 확인
  const { error: schemaErr } = await admin.from("projects").select("id").limit(1);
  if (schemaErr) {
    throw new Error(
      `스키마가 없습니다 (${schemaErr.message}). ` +
        `Supabase Dashboard > SQL Editor에 supabase/ALL_MIGRATIONS.sql 내용을 붙여넣고 실행한 뒤 다시 시도하세요.`
    );
  }

  // 1) 테스트 유저 (이미 있으면 재사용)
  let userId: string;
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (created?.user) {
    userId = created.user.id;
  } else {
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users.find((u) => u.email === E2E_EMAIL);
    if (!existing) throw new Error(`테스트 유저 생성 실패: ${uErr?.message}`);
    userId = existing.id;
  }
  console.log(`  유저: ${E2E_EMAIL} (${userId})`);

  // 2) 프로젝트
  const { data: project, error: pErr } = await admin
    .from("projects")
    .insert({ owner_id: userId, title: `E2E ${new Date().toISOString().slice(0, 16)}` })
    .select("id")
    .single();
  if (pErr || !project) throw new Error(`프로젝트 생성 실패: ${pErr?.message}`);
  console.log(`  프로젝트: ${project.id}`);

  // 3) txt 업로드 (웹과 동일한 경로 규칙: {userId}/{projectId}/{uuid}.txt)
  const txt = readFileSync("samples/sample-handover.txt");
  const path = `${userId}/${project.id}/${randomUUID()}.txt`;
  const { error: upErr } = await admin.storage
    .from("videos")
    .upload(path, txt, { contentType: "text/plain" });
  if (upErr) throw new Error(`Storage 업로드 실패: ${upErr.message} (0002 마이그레이션 확인)`);
  console.log(`  업로드: ${path}`);

  // 4) video 행 (.txt → duration null, 비용 가드는 0초로 항상 통과하는 케이스)
  const { data: video, error: vErr } = await admin
    .from("videos")
    .insert({ project_id: project.id, storage_path: path, duration_seconds: null, status: "uploaded" })
    .select("id")
    .single();
  if (vErr || !video) throw new Error(`video 행 생성 실패: ${vErr?.message}`);

  // 5) 파이프라인 직접 구동 (웹에서는 after() 훅이 동일 함수 호출)
  console.log(`  파이프라인 실행 중 (실 Claude API 2회: 구조화 + 보강 질문)...`);
  const { processVideo } = await import("../lib/pipeline/process-video");
  await processVideo(video.id);

  // 6) 검증
  const { data: v } = await admin
    .from("videos")
    .select("status, error_message")
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

  const segCount = Array.isArray(transcript?.segments) ? transcript.segments.length : 0;
  const qCount = Array.isArray(doc?.enrich_questions) ? doc.enrich_questions.length : 0;

  const { DocumentSchema } = await import("../lib/ai/schema");
  const parsed = DocumentSchema.safeParse(doc?.content);

  console.log(`\n=== E2E 결과`);
  console.log(`  video: done ✓`);
  console.log(`  transcript: 세그먼트 ${segCount}개 ${segCount > 0 ? "✓" : "✗"}`);
  console.log(`  document: ${doc?.id} (${doc?.prompt_version}) 스키마 ${parsed.success ? "✓" : "✗ " + parsed.error?.message}`);
  console.log(`  보강 질문: ${qCount}개 ${qCount > 0 ? "✓" : "✗"}`);
  console.log(`  ai_usage_logs: ${(logs ?? []).map((l) => l.kind).join(", ")}`);
  console.log(`\n  웹 확인: npm run dev → ${E2E_EMAIL} / ${E2E_PASSWORD} 로그인 → 문서 /documents/${doc?.id}`);

  if (segCount === 0 || !parsed.success || !doc) throw new Error("검증 항목 실패 (위 ✗ 참고)");
}
