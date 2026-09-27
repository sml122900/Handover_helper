import { findEnvProblems } from "./env";

// production은 누락 시 부팅 실패, dev는 경고만
// next build 단계는 제외: CI·로컬 빌드는 키 없이 통과해야 함
if (process.env.NEXT_PHASE !== "phase-production-build") {
  const problems = findEnvProblems();
  if (problems.length > 0) {
    const report = `[env] 환경변수 확인 필요 (.env.example 참고):\n  - ${problems.join("\n  - ")}`;
    if (process.env.NODE_ENV === "production") {
      // throw만 하면 next start는 "Failed to prepare server" 후에도 프로세스가 살아 있음 → 명시 종료
      console.error(report);
      process.exit(1);
    }
    console.warn(report);
  }
}
