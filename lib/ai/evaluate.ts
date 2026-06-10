import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EvalResultSchema, type EvalResult } from "./eval-schema";
import {
  EVAL_SYSTEM_PROMPT,
  buildEvalUserPrompt,
  EVAL_PROMPT_VERSION,
} from "./prompts/evaluate-v1";

export const EVAL_MODEL = process.env.HANDOVER_EVAL_MODEL ?? "claude-sonnet-4-6";
export { EVAL_PROMPT_VERSION };

export interface EvalRunResult {
  result: EvalResult;
  meta: { model: string; inputTokens: number; outputTokens: number };
}

// Claude 심판 채점 1회 (evaluate.ts / compare-prompts.ts 공용)
export async function runEvaluation(
  client: Anthropic,
  args: { goldenMarkdown: string; aiDocumentJson: string; transcriptText?: string }
): Promise<EvalRunResult> {
  const response = await client.messages.parse({
    model: EVAL_MODEL,
    max_tokens: 16000,
    system: EVAL_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildEvalUserPrompt(args) }],
    output_config: { format: zodOutputFormat(EvalResultSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`채점 출력 파싱 실패 (stop_reason=${response.stop_reason})`);
  }
  return {
    result: EvalResultSchema.parse(response.parsed_output),
    meta: {
      model: EVAL_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
