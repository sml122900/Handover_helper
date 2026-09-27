// 사용자에게 그대로 보여도 되는 에러 (한국어, 원인 + 다음 행동). 그 외 에러는 일반 문구로 대체
export class UserFacingError extends Error {}

export const GENERIC_PIPELINE_ERROR =
  "문서 변환 중 오류가 발생했습니다. '다시 시도'를 눌러 주세요. 반복되면 파일을 다시 업로드하세요.";

// 내부 메시지(스택·경로·외부 API 응답)는 화면·DB에 노출하지 않음
export function toUserMessage(e: unknown): string {
  if (e instanceof UserFacingError) return e.message;
  const msg = e instanceof Error ? e.message : "";
  // structureTranscript의 비용 가드·빈 입력 안내는 사용자 행동 안내라 통과
  if (msg.startsWith("비용 가드:") || msg === "트랜스크립트가 비어 있습니다.") return msg;
  return GENERIC_PIPELINE_ERROR;
}
