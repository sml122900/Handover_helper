# structured output "compiled grammar is too large" 400 에러

## 문제상황
문서 스키마 v2 개편에서 8개 항목 타입 전부에 `inferred: boolean`을 추가하자
Claude API structured outputs(`output_config.format` + zodOutputFormat)가
400 거부: "The compiled grammar is too large, which would cause performance
issues. Simplify your tool schemas." v1 스키마는 같은 구조로 정상 동작했음.

## 시도한 것들
1. zod `.describe()` 한국어 설명 전부 축약/제거 → **여전히 400**.
   설명 텍스트는 grammar 크기와 무관 — 구조적 복잡도(필드 수, nullable 유니온,
   enum, 객체 인라인)가 원인
2. 원인 분석: v1이 이미 한도 직전이었고, v2의 +9 필드(inferred ×8 + contact)가
   한도를 넘김. itemBase(sourceTimestamp 객체 + confidence enum)가 8개 타입에
   인라인 복제되는 구조라 필드 1개 추가가 ×8로 증폭됨

## 최종 해결법
`inferred`를 절차(ProcedureStep) 전용으로 한정 — 필드 7개 감축으로 한도 내 복귀.
근거: AI 보완 원칙 자체가 "생략된 **단계**를 추론으로 채움"이므로 절차 한정이
기능 손실이 아니라 요구사항과 정합. 스키마 주석 + CLAUDE.md에 한도 사실을 명기해
후속 작업자가 무심코 전 항목 확장하다 재발하지 않게 함.

## 교훈
- structured output 스키마는 필드 추가가 공짜가 아니다 — 공통 베이스가 N개 타입에
  인라인되는 구조에선 1필드 = N필드
- 한도성 제약은 코드 주석만으로 부족 — 스키마 변경 규칙이 있는 문서(CLAUDE.md)에
  같이 박아야 재발 방지
- describe 축약은 grammar 한도 대응이 아님 (토큰 비용 절감일 뿐)

## 이력서 소재 한 줄
LLM structured output의 grammar 크기 한도를 스키마 구조 분석(공통 베이스 인라인 증폭)으로
진단하고, 도메인 요구사항을 재해석해 필드 범위를 한정함으로써 기능 손실 없이 해결.
