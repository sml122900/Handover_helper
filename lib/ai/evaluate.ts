import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { JudgeOutputSchema, type ChecklistItem, type EvalResult } from "./eval-schema";
import { flattenDocumentClaims, applyJudgments } from "./eval-core";
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt, JUDGE_PROMPT_VERSION } from "./prompts/judge-v1";
import type { HandoverDocument } from "./schema";

export const EVAL_MODEL = process.env.HANDOVER_EVAL_MODEL ?? "claude-sonnet-4-6";
export { JUDGE_PROMPT_VERSION };

export interface EvalRunResult {
  result: EvalResult;
  meta: { model: string; inputTokens: number; outputTokens: number };
}

// 체크리스트 기반 채점 1회 (evaluate.ts / compare-prompts.ts 공용)
// 심판은 항목별 yes/no + 근거 인용만 (temperature 0). 누락률·환각 집계는 코드가 계산.
export async function runEvaluation(
  client: Anthropic,
  args: {
    checklist: ChecklistItem[];
    aiDocument: HandoverDocument;
    transcriptText?: string;
    goldenMarkdown?: string;
  }
): Promise<EvalRunResult> {
  const claims = flattenDocumentClaims(args.aiDocument);

  const response = await client.messages.parse({
    model: EVAL_MODEL,
    max_tokens: 16000,
    temperature: 0,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildJudgeUserPrompt({
          facts: args.checklist.map((c, i) => ({ index: i, fact: c.fact })),
          claims,
          transcriptText: args.transcriptText,
          goldenMarkdown: args.goldenMarkdown,
        }),
      },
    ],
    output_config: { format: zodOutputFormat(JudgeOutputSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`심판 출력 파싱 실패 (stop_reason=${response.stop_reason})`);
  }
  const judge = JudgeOutputSchema.parse(response.parsed_output);

  return {
    result: applyJudgments({ checklist: args.checklist, claims, judge }),
    meta: {
      model: EVAL_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
