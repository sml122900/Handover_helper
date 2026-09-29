// 날짜·시각 표시 공용 — 서버(Vercel, UTC)·브라우저 어디서 실행돼도 항상 한국 시각(KST)으로 표시.
// 저장은 UTC(timestamptz) 그대로 두고 표시할 때만 변환한다. 표시 지점은 이 함수만 사용할 것.
// 오전/오후 표기는 Node ICU 버전에 따라 AM/PM으로 나오는 경우가 있어 24시간제 숫자로 직접 조립한다.
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(input: string | number | Date): Record<string, string> {
  return Object.fromEntries(fmt.formatToParts(new Date(input)).map((p) => [p.type, p.value]));
}

/** 예: 2026. 9. 30. */
export function formatDate(input: string | number | Date): string {
  const p = parts(input);
  return `${p.year}. ${p.month}. ${p.day}.`;
}

/** 예: 2026. 9. 30. 15:05 */
export function formatDateTime(input: string | number | Date): string {
  const p = parts(input);
  return `${p.year}. ${p.month}. ${p.day}. ${p.hour}:${p.minute}`;
}
