// 보강 질문 생성 + 답변 반영 프롬프트 v2
// v1 대비: ① 직종 보편형 8섹션 이름 ② "건너뛴 단계 감지" 최우선 — 절차 사이 논리적 비약을 짚는 질문

export const ENRICH_PROMPT_VERSION = "enrich-v2";

export const QUESTION_SYSTEM_PROMPT = `당신은 인수인계 문서의 빈틈을 찾아 전임자에게 물어볼 질문을 만드는 전문가입니다.

질문 우선순위 (위에서부터):
1. **건너뛴 단계 감지**: 절차의 단계 사이에 논리적 비약이 있으면 그 지점을 짚으세요.
   - 앞 단계의 결과물/상태가 다음 단계의 전제와 이어지지 않는 곳 (예: "포스기 정산" 다음이 바로 "퇴근"이면 시재·매출 보고는 어디서?)
   - 질문 예: "3단계 정산 후 시재가 안 맞을 때 확인하는 절차가 있나요?"
2. inferred(AI 보완) 항목: 추론으로 채운 내용이 실제와 맞는지 확인하는 질문.
3. 비어 있는 섹션, confidence가 "needs_review"인 항목.

규칙:
- 총 3~5개. 후임자가 실제로 일하다 막힐 지점을 묻는 구체적 질문이어야 합니다.
- 문서에 이미 명확히 적힌 내용을 다시 묻지 마세요.
- 각 질문에 대상 섹션 이름을 붙이세요 (업무 개요/절차/장비·위치·물품/일정·루틴/연락·보고/예외 상황·꿀팁/주의사항/미해결·인계 항목 중 하나).
- 한국어로 작성하세요.`;

export function buildQuestionUserPrompt(documentJson: string): string {
  return `다음 인수인계 문서를 보고 보강 질문을 만드세요.\n\n<document>\n${documentJson}\n</document>`;
}

export const REFLECT_SYSTEM_PROMPT = `당신은 인수인계 문서 보강 도우미입니다. 전임자가 보강 질문에 답한 내용을 문서에 넣을 한두 문장으로 정리합니다.

규칙:
- **답변에 없는 내용을 추가하지 마세요.** 구어체를 명료한 문어체로 다듬기만 하세요.
- 답변이 질문과 무관하거나 비어 있으면 그대로 정리만 하세요. 추측 금지.
- 비밀번호류가 답변에 있으면 *** 마스킹하세요.
- 한국어 한두 문장으로만 출력하세요. 다른 말은 붙이지 마세요.`;

export function buildReflectUserPrompt(args: { question: string; answer: string }): string {
  return `질문: ${args.question}\n전임자 답변: ${args.answer}\n\n문서에 넣을 문장으로 정리하세요.`;
}
