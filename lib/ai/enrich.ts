import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { STRUCTURE_MODEL } from "./structure";
import {
  QUESTION_SYSTEM_PROMPT,
  buildQuestionUserPrompt,
  REFLECT_SYSTEM_PROMPT,
  buildReflectUserPrompt,
} from "./prompts/enrich-v2";

// 보강 질문: 변환 직후 빈/불확실 섹션에 대해 3~5개 생성 → documents.enrich_questions(jsonb)

export const EnrichQuestionSchema = z.object({
  section: z.string().describe("대상 섹션 이름"),
  question: z.string(),
});

export const EnrichQuestionsSchema = z.object({
  questions: z.array(EnrichQuestionSchema).describe("3~5개"),
});

export interface EnrichQuestion {
  section: string;
  question: string;
  answered: boolean;
}

export interface UsageMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function generateEnrichQuestions(
  documentJson: string
): Promise<{ questions: EnrichQuestion[]; usage: UsageMeta }> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: STRUCTURE_MODEL,
    max_tokens: 2000,
    system: QUESTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildQuestionUserPrompt(documentJson) }],
    output_config: { format: zodOutputFormat(EnrichQuestionsSchema) },
  });
  if (!response.parsed_output) throw new Error("보강 질문 생성 파싱 실패");
  return {
    questions: response.parsed_output.questions
      .slice(0, 5)
      .map((q) => ({ ...q, answered: false })),
    usage: {
      model: STRUCTURE_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// 사용자의 답변을 문서에 넣을 문장으로 다듬기 (내용 추가 금지 — 환각 가드)
export async function reflectAnswer(args: {
  question: string;
  answer: string;
}): Promise<{ text: string; usage: UsageMeta }> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: STRUCTURE_MODEL,
    max_tokens: 500,
    system: REFLECT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildReflectUserPrompt(args) }],
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("답변 정리에 실패했습니다.");
  return {
    text,
    usage: {
      model: STRUCTURE_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
