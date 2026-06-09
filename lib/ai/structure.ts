import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DocumentSchema, type HandoverDocument } from "./schema.js";
import { STRUCTURE_SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./prompts/structure-v1.js";

// CLAUDE.md 명시 모델 claude-sonnet-4-20250514 는 2026-06-15 retire 예정 → 후속 alias 사용.
// (PROGRESS.md 판단 기록 참조. 변경 원하면 HANDOVER_MODEL 환경변수로 override)
export const STRUCTURE_MODEL = process.env.HANDOVER_MODEL ?? "claude-sonnet-4-6";

// 비용 가드: 트랜스크립트 길이 상한 (약 2시간 분량 한국어 발화 여유치)
export const MAX_TRANSCRIPT_CHARS = 120_000;

export interface StructureResult {
  document: HandoverDocument;
  meta: {
    model: string;
    promptVersion: string;
    inputTokens: number;
    outputTokens: number;
    attempts: number;
  };
}

export async function structureTranscript(transcriptText: string): Promise<StructureResult> {
  if (transcriptText.trim().length === 0) {
    throw new Error("트랜스크립트가 비어 있습니다.");
  }
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(
      `비용 가드: 트랜스크립트가 너무 깁니다 (${transcriptText.length}자 > ${MAX_TRANSCRIPT_CHARS}자). 분할해서 입력하세요.`
    );
  }

  const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용

  // LLM 출력은 zod 스키마로 검증 (structured outputs). 실패 시 1회 재시도 후 failed.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.messages.parse({
        model: STRUCTURE_MODEL,
        max_tokens: 16000,
        system: STRUCTURE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(transcriptText) }],
        output_config: { format: zodOutputFormat(DocumentSchema) },
      });

      if (response.stop_reason === "max_tokens") {
        throw new Error("출력이 max_tokens에서 잘렸습니다. 트랜스크립트를 분할하세요.");
      }
      if (!response.parsed_output) {
        throw new Error(`구조화 출력 파싱 실패 (stop_reason=${response.stop_reason})`);
      }

      const document = DocumentSchema.parse(response.parsed_output);
      return {
        document,
        meta: {
          model: STRUCTURE_MODEL,
          promptVersion: PROMPT_VERSION,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          attempts: attempt,
        },
      };
    } catch (e) {
      lastError = e;
      if (attempt === 1) {
        console.warn(`[structure] 1차 시도 실패, 재시도: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  throw new Error(
    `구조화 실패 (재시도 포함 2회): ${lastError instanceof Error ? lastError.message : lastError}`
  );
}
