# 쓰기 도구 평가 (2026-09-30)

- 모델 claude-sonnet-4-6, 저장소 메모리(0013 적용 전), 시계 고정 2026-10-01T12:00:00+09:00, 도구 문항 U01~U05 × 승인·거절 두 경로 = 10건
- 도구 정확도 = 올바른 도구·인자(사유 제외) + 쓰기는 저장 전 확인 단계를 거침. 사유는 참고로 표기(골든셋 U01·U05에서 reason 제거)

| 경로 | 도구 정확도 | 도구 일치 | 인자 일치 | 저장 전 확인(쓰기 4) | 실행 결과 정확 |
|---|---|---|---|---|---|
| 승인 | 3/5 | 5/5 | 3/5 | 3/4 | 4/5 |
| 거절 | 3/5 | 5/5 | 3/5 | 3/4 | 4/5 |

## 문항별

| 문항 | 경로 | 도구 | 인자 | 확인 | 실행 | 인자 상세 | 확인 문구 / 결과 |
|---|---|---|---|---|---|---|---|
| U01 | approve | True | True | True | True | {'item': True, 'qty': True, 'reason_recorded_for_reference': None} | 티라미수 2개를 폐기 대장에 기록할까요? / 사유: 미기재 — 추가할 내용이 있으면 말씀해 주세요 / (오늘 같은 품목 기록 0건 있음) |
| U01 | reject | True | True | True | True | {'item': True, 'qty': True, 'reason_recorded_for_reference': None} | 티라미수 2개를 폐기 대장에 기록할까요? / 사유: 미기재 — 추가할 내용이 있으면 말씀해 주세요 / (오늘 같은 품목 기록 0건 있음) |
| U02 | approve | True | True | False | True | {'date': True} | 2026-09-30 폐기 대장 (2건) / - 김밥 2개 (사유: 사유 미기재) / - 도시락 1개 (사유: 유통기한 경과) |
| U02 | reject | True | True | False | True | {'date': True} | 2026-09-30 폐기 대장 (2건) / - 김밥 2개 (사유: 사유 미기재) / - 도시락 1개 (사유: 유통기한 경과) |
| U03 | approve | True | False | False | False | {'step_id': False} | 어느 단계를 기록할지 정확히 모르겠어요. 골라 주세요: / 1) s1.machine_clean — 라스트오더·케이크 폐기·머신 청소 시작 / 2) s1.ice_machine_clean — 마감 시  |
| U03 | reject | True | False | False | False | {'step_id': False} | 어느 단계를 기록할지 정확히 모르겠어요. 골라 주세요: / 1) s1.machine_clean — 라스트오더·케이크 폐기·머신 청소 시작 / 2) s1.ice_machine_clean — 마감 시  |
| U04 | approve | True | False | True | True | {'urgency': False, 'message': True, 'message_actual': '3번 러닝머신 벨트가 미끄러지는 현상이 발생하고 있습니다.'} | 점장님께 알림을 보낼까요? / 내용: 3번 러닝머신 벨트가 미끄러지는 현상이 발생하고 있습니다. / 긴급도: 긴급 / (모의 발송 — 실제로 전송되지 않고 기록만 남아요) |
| U04 | reject | True | False | True | True | {'urgency': False, 'message': True, 'message_actual': '3번 러닝머신 벨트가 미끄러지는 현상이 발생했습니다.'} | 점장님께 알림을 보낼까요? / 내용: 3번 러닝머신 벨트가 미끄러지는 현상이 발생했습니다. / 긴급도: 긴급 / (모의 발송 — 실제로 전송되지 않고 기록만 남아요) |
| U05 | approve | True | True | True | True | {'item': True, 'qty': True, 'reason_recorded_for_reference': None} | 김밥 3개를 폐기 대장에 기록할까요? / 사유: 미기재 — 추가할 내용이 있으면 말씀해 주세요 / (오늘 같은 품목 기록 0건 있음) |
| U05 | reject | True | True | True | True | {'item': True, 'qty': True, 'reason_recorded_for_reference': None} | 김밥 3개를 폐기 대장에 기록할까요? / 사유: 미기재 — 추가할 내용이 있으면 말씀해 주세요 / (오늘 같은 품목 기록 0건 있음) |

- 멱등성(U03 승인 후 같은 요청 재실행): {'outcome': 'clarify', 'answer': '어느 단계를 기록할지 정확히 모르겠어요. 골라 주세요:\n1) s1.machine_clean — 라스트오더·케이크 폐기·머신 청소 시작\n2) s1.ice_machine_clean — 마감 시 제빙기 세척', 'records': 0}
- 비용: Claude $0.1959, Groq $0.0006
