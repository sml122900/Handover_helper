# 트러블슈팅: 토스페이먼츠 SDK 키·API 불일치

**날짜**: 2026-06-13  
**소요 시간**: 약 30분 (3단계 디버깅)

---

## 문제 상황

`@tosspayments/tosspayments-sdk` 설치 후 위젯 로딩 시 연속 에러 3가지 발생.

---

## 시도한 것들

### 1단계: `loadPaymentWidget` 미존재
```
Export loadPaymentWidget doesn't exist in target module
Did you mean to import loadTossPayments?
```
- **원인**: 공식 문서 예제가 `loadPaymentWidget`을 쓰지만 설치된 패키지 버전(2.7.x)은 `loadTossPayments`만 export
- **수정**: `loadTossPayments(clientKey)` → `.widgets({ customerKey })` → `.setAmount()` → `.renderPaymentMethods()` 패턴으로 교체

### 2단계: `variantKey` 에러 + `customerKey` UUID 거부
- `variantKey: "DEFAULT"` / `"AGREEMENT"` — 대시보드에 등록된 변형이 없으면 에러
- `customerKey: userId` (UUID) — 비회원 결제는 `ANONYMOUS` 상수 필요
- **수정**: `variantKey` 제거, `customerKey: ANONYMOUS` 적용

### 3단계: API 개별 키로 위젯 SDK 사용
```
결제위젯 연동 키의 클라이언트 키로 SDK를 연동해주세요.
API 개별 연동 키는 지원하지 않습니다.
```
- **원인**: 토스 키는 두 종류
  - **API 개별 연동 키** (`test_ck_...`) — 결제창 직접 호출용, 사업자 등록 전에도 발급 가능
  - **결제위젯 연동 키** — 위젯 SDK 전용, 사업자 등록 후 발급
- 현재 보유 키 = API 개별 연동 키 → `@tosspayments/tosspayments-sdk`(위젯) 사용 불가
- **수정**: `@tosspayments/payment-sdk`(결제창, API 개별 키 호환)로 패키지 교체

---

## 최종 해결법

```typescript
import { loadTossPayments } from "@tosspayments/payment-sdk";

const tossPayments = await loadTossPayments(clientKey);
await tossPayments.requestPayment("카드", {
  amount, orderId, orderName, customerEmail, successUrl, failUrl,
});
```

- 위젯 컨테이너 div 불필요, 결제 버튼 클릭 → 토스 결제창 팝업 오픈
- 사업자 등록 후 위젯 키 발급 받으면 `@tosspayments/tosspayments-sdk`로 교체 가능

---

## 이력서 소재 한 줄

> 토스페이먼츠 SDK 3단계 연속 에러(API 불일치 → 키 타입 혼동 → variantKey 미등록)를 각 에러 메시지 분석과 SDK 소스 직접 열람으로 30분 내 해결, 사업자 미등록 환경에서도 결제 플로우 완성
