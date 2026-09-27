// 서버 부팅 훅 — env 검증 (Node 런타임 전용 모듈로 분리: Edge 번들에 process.exit 포함 방지)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/env-check");
}
