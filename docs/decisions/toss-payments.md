# 기술 결정: 토스페이먼츠 건당 결제

**날짜**: 2026-06-13  
**구조**: PAR (Problem → Action → Result)

---

## Problem

MVP 수익화를 위해 결제가 필요하나 세 가지 제약:
1. **사업자 미등록** — 결제위젯 연동 키 발급 불가, API 개별 연동 키만 보유
2. **솔로 운영** — PG사 서버 직접 운영, 복잡한 결제 미들웨어 도입 불가
3. **금액 변조 방지** — 클라이언트가 amount를 조작해 서버에 보내는 공격 방어 필수

---

## Action

### 결제 방식: 건당 결제 (9,900원/프로젝트)
- 구독보다 초기 마찰 낮음, 솔로 SaaS에 적합
- 프로젝트당 1회 결제 → `projects.plan = 'paid'` 전환 → 2시간 한도 적용

### SDK: `@tosspayments/payment-sdk` (결제창)
- API 개별 키 호환 — 사업자 등록 전 즉시 사용 가능
- 위젯 없이 결제창 팝업 직접 오픈 (`requestPayment("카드", {...})`)
- 사업자 등록 후 `@tosspayments/tosspayments-sdk` (위젯)으로 교체 경로 유지

### 서버 승인 + 금액 검증
```
클라이언트 → successUrl 리다이렉트 (paymentKey, orderId, amount)
서버 → DB amount 조회 → 요청 amount 비교 → 일치 시만 Toss confirm API 호출
→ status=DONE → projects.plan=paid 전환
```
- 금액은 서버 DB가 정답, 클라이언트 값은 참고만
- `validateConfirmRequest` 순수 함수 → vitest 단위 테스트 7개 (금액 변조·이중 승인·잘못된 상태)

### 멱등성 처리
- success URL 중복 접근(새로고침, 뒤로 가기) 시 `payment.status === "confirmed"` 체크 후 즉시 리다이렉트

---

## Result

- 결제 → 승인 → PRO 배지까지 서버리스 환경에서 동작
- 금액 검증 로직 vitest 커버리지 100% (7/7)
- 사업자 등록 후 위젯 교체 시 `PaymentWidget.tsx` 1파일만 수정
