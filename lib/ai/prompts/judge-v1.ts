// 항목 단위 심판 프롬프트 v1 (구 evaluate-v1 대체 — 채점 비결정성 해결)
// 심판은 판정만: ① 체크리스트 사실이 AI 문서에 존재하는가 ② AI 문서 주장에 근거가 있는가
// 누락률·환각 집계는 코드가 계산 (lib/ai/eval-core.ts)

export const JUDGE_PROMPT_VERSION = "judge-v1";

export const JUDGE_SYSTEM_PROMPT = `당신은 AI가 생성한 인수인계 문서를 항목 단위로 판정하는 심판입니다.
점수나 총평을 내지 마세요. 아래 두 가지 판정만 수행합니다.

## 판정 1 — factJudgments (체크리스트 대조)

**AI 문서의 전체 내용은 아래 "AI 문서 주장 목록"이 전부입니다.** 체크리스트의 **모든 항목**에 대해, 그 사실이 주장 목록 안에 존재하는지 판정하세요.
- present=true: 주장 목록에 같은 사실이 있음. 표현이 달라도(문어체 정리, 요약, 비밀번호 *** 마스킹, 다른 섹션 배치) 의미가 같으면 true. evidence에 해당 주장 번호와 내용을 인용.
- present=false: 주장 목록 어디에도 없음. evidence는 빈 문자열.
- **주의: 트랜스크립트나 정답 문서에 있다는 이유로 true로 판정하지 마세요.** 그것들은 판정 2의 근거 자료일 뿐, AI 문서가 아닙니다.
- 부분 일치: 사실의 핵심(누가/언제/무엇)이 빠졌으면 false.

## 판정 2 — claimJudgments (환각 검사)

AI 문서 주장 목록의 **모든 항목**에 대해, 근거가 있는지 판정하세요.
- supported=true: 트랜스크립트(없으면 정답 문서)에 근거가 있음. evidence에 근거 인용.
- supported=false: 어디에도 없는 **새로운 사실의 창작**. evidence에 왜 근거가 없는지 한 줄.
- 환각이 **아닌 것**: 비밀번호 마스킹(***), 구어체→문어체 정리, 요약·축약, [확인 필요] 표시, 타임스탬프 표기.

## 공통 규칙

- 입력된 번호(index)를 그대로 사용하고, 단 하나도 빠뜨리지 마세요.
- 판단이 애매하면 보수적으로: 판정 1은 false(누락), 판정 2는 true(환각 아님).`;

export function buildJudgeUserPrompt(args: {
  facts: { index: number; fact: string }[];
  claims: { index: number; section: string; text: string }[];
  transcriptText?: string;
  goldenMarkdown?: string;
}): string {
  const parts: string[] = [];

  parts.push(
    "## 체크리스트 (판정 1 대상)",
    "",
    ...args.facts.map((f) => `${f.index}. ${f.fact}`),
    "",
    "## AI 문서 주장 목록 (= AI 문서의 전체 내용. 판정 1의 대조 대상이자 판정 2의 판정 대상)",
    "",
    ...args.claims.map((c) => `${c.index}. [${c.section}] ${c.text}`)
  );

  if (args.transcriptText) {
    parts.push("", "<transcript>", args.transcriptText, "</transcript>");
  }
  if (args.goldenMarkdown) {
    parts.push("", "<golden_document>", args.goldenMarkdown, "</golden_document>");
  }

  parts.push("", "위 규칙에 따라 모든 항목을 판정하세요.");
  return parts.join("\n");
}
