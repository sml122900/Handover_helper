// AI 산출 문서 채점 프롬프트 v1 (Claude를 심판으로 사용)

export const EVAL_PROMPT_VERSION = "evaluate-v1";

export const EVAL_SYSTEM_PROMPT = `당신은 인수인계 문서 변환 품질을 채점하는 엄격한 심판입니다.
비교 대상: (A) 사람이 작성한 정답 문서, (B) AI가 트랜스크립트에서 생성한 문서, (C) 원본 트랜스크립트(있는 경우).

## 채점 기준

1. **누락 (missedItems)**
   - 먼저 정답 문서에서 "후임자가 일하는 데 필요한 핵심 정보"를 항목 단위로 모두 식별하고 그 총 개수를 goldenKeyItemCount에 기록하세요.
   - 그중 AI 문서에 없거나 의미가 누락된 항목을 missedItems에 나열하세요.
   - 표현이 달라도 의미가 보존되면 누락이 아닙니다.

2. **환각 (hallucinations)**
   - AI 문서에 있지만 정답 문서와 트랜스크립트 어디에도 근거가 없는 내용을 나열하세요.
   - 구어체→문어체 정리, 합리적 요약은 환각이 아닙니다. **새로운 사실의 창작**만 환각입니다.
   - 보안 마스킹(***)은 환각이 아닙니다.

3. **섹션별 점수 (sectionScores)** — 8개 섹션 각각 0~10점
   업무 개요 / 업무 절차 / 계정·접근 권한 / 관계자 맵 / 일정·데드라인 / 주의사항·암묵지 / 미해결 이슈 / FAQ
   - 10점: 정답과 동등하거나 더 명료
   - 7~9점: 사소한 누락/어색함
   - 4~6점: 의미 있는 누락 또는 부정확
   - 0~3점: 심각한 누락/오류/환각

4. **총평 (overallComment)** — 강점, 약점, 프롬프트 개선 방향을 구체적으로.

판단이 애매하면 사용자(제품) 관점에서 보수적으로(엄격하게) 채점하세요. 모든 텍스트는 한국어로.`;

export function buildEvalUserPrompt(args: {
  goldenMarkdown: string;
  aiDocumentJson: string;
  transcriptText?: string;
}): string {
  const parts = [
    "## (A) 정답 문서 (사람 작성)",
    "<golden>",
    args.goldenMarkdown,
    "</golden>",
    "",
    "## (B) AI 산출 문서 (JSON)",
    "<ai_document>",
    args.aiDocumentJson,
    "</ai_document>",
  ];
  if (args.transcriptText) {
    parts.push("", "## (C) 원본 트랜스크립트", "<transcript>", args.transcriptText, "</transcript>");
  }
  parts.push("", "위 기준에 따라 채점하세요.");
  return parts.join("\n");
}
