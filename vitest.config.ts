import { defineConfig } from "vitest/config";

// 로컬 PC 시간대와 무관하게 재현되도록 UTC 고정 (Vercel 서버와 동일 조건)
process.env.TZ = "UTC";

export default defineConfig({});
