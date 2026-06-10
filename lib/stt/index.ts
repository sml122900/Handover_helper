import { MockStt } from "./mock";
import { WhisperStt } from "./whisper";
import type { SttProvider } from "./types";

// STT 프로바이더 선택 (env 전환)
//   HANDOVER_STT=whisper → Whisper 강제 (키 없으면 호출 시 에러)
//   HANDOVER_STT=mock    → mock 강제
//   미설정              → OPENAI_API_KEY 있으면 whisper, 없으면 mock
export function getSttProvider(
  env: Record<string, string | undefined> = process.env
): SttProvider {
  const mode = env.HANDOVER_STT?.toLowerCase();
  if (mode === "mock") return new MockStt();
  if (mode === "whisper") return new WhisperStt(env.OPENAI_API_KEY);
  if (mode) throw new Error(`알 수 없는 HANDOVER_STT 값: ${mode} (whisper | mock)`);
  return env.OPENAI_API_KEY ? new WhisperStt(env.OPENAI_API_KEY) : new MockStt();
}
