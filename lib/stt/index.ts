import { MockStt } from "./mock";
import { WhisperStt } from "./whisper";
import { GroqStt } from "./groq";
import type { SttProvider } from "./types";

// STT 프로바이더 선택 (env 전환)
//   HANDOVER_STT=groq    → Groq Whisper (GROQ_API_KEY 필요)
//   HANDOVER_STT=whisper → OpenAI Whisper (OPENAI_API_KEY 필요)
//   HANDOVER_STT=mock    → mock 강제
//   미설정              → GROQ_API_KEY → groq, OPENAI_API_KEY → whisper, 없으면 mock
export function getSttProvider(
  env: Record<string, string | undefined> = process.env
): SttProvider {
  const mode = env.HANDOVER_STT?.toLowerCase();
  if (mode === "mock") return new MockStt();
  if (mode === "whisper") return new WhisperStt(env.OPENAI_API_KEY);
  if (mode === "groq") return new GroqStt(env.GROQ_API_KEY);
  if (mode) throw new Error(`알 수 없는 HANDOVER_STT 값: ${mode} (groq | whisper | mock)`);
  // 자동 선택: Groq 우선 (속도), OpenAI 폴백, 없으면 mock
  if (env.GROQ_API_KEY) return new GroqStt(env.GROQ_API_KEY);
  if (env.OPENAI_API_KEY) return new WhisperStt(env.OPENAI_API_KEY);
  return new MockStt();
}
