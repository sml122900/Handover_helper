import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ChecklistSchema, type ChecklistItem } from "./eval-schema";
import {
  CHECKLIST_SYSTEM_PROMPT,
  buildChecklistUserPrompt,
  CHECKLIST_PROMPT_VERSION,
} from "./prompts/checklist-v1";

export const CHECKLIST_MODEL = process.env.HANDOVER_EVAL_MODEL ?? "claude-sonnet-4-6";
export { CHECKLIST_PROMPT_VERSION };

// 정답 문서 → 원자적 사실 체크리스트 (샘플당 1회 호출 후 golden/{name}-checklist.json 캐시)
export async function buildChecklist(
  client: Anthropic,
  goldenMarkdown: string
): Promise<{ items: ChecklistItem[]; meta: { model: string; inputTokens: number; outputTokens: number } }> {
  const response = await client.messages.parse({
    model: CHECKLIST_MODEL,
    max_tokens: 8000,
    temperature: 0,
    system: CHECKLIST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildChecklistUserPrompt(goldenMarkdown) }],
    output_config: { format: zodOutputFormat(ChecklistSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`체크리스트 출력 파싱 실패 (stop_reason=${response.stop_reason})`);
  }
  const { items } = ChecklistSchema.parse(response.parsed_output);
  if (items.length === 0) throw new Error("체크리스트가 비어 있습니다 (정답 문서 확인)");
  return {
    items,
    meta: {
      model: CHECKLIST_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
