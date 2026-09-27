// 개인식별정보 마스킹 (코드 계층 — 프롬프트 마스킹 지시와 이중 안전망)
// 대상: 주민·외국인등록번호 → [주민번호], 카드번호 → [카드번호]
// 보존: 전화번호·업무 비밀번호/PIN·사업자번호·계좌번호·일련번호·금액·타임스탬프
//   (과거 업무 비밀번호를 지워 critical 누락 2건 → 범위를 넓히지 말 것. 오탐 = 인수인계 정보 손실)

// YYMMDD + (하이픈|공백)? + 성별/국적 자리 1~8 + 6자리
const RRN = /(?<!\d)(\d{2})(\d{2})(\d{2})[- ]?([1-8])\d{6}(?!\d)/g;

// 15·16자리만: 연속 / 4-4-4-4 / 4-6-5(Amex), 구분자는 공백·하이픈 중 하나로 일관
const CARD = /(?<!\d)(?:\d{15,16}|\d{4}([ -])\d{4}\1\d{4}\1\d{4}|\d{4}([ -])\d{6}\2\d{5})(?!\d)/g;

function isValidBirthDate(yy: string, mm: string, dd: string, genderDigit: string): boolean {
  const century = "1256".includes(genderDigit) ? 1900 : 2000;
  const year = century + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 구분자 없는 13자리는 EAN-13 바코드와 충돌 (국내 880xxx… → 88년생 날짜로 해석됨)
// EAN 체크섬 통과 + 주민번호 체크섬 실패면 바코드로 보고 보존
function eanValid(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[12]);
}

function rrnChecksumValid(d: string): boolean {
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}

function looksLikeBarcode(match: string): boolean {
  return /^\d{13}$/.test(match) && eanValid(match) && !rrnChecksumValid(match);
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// 발급사 범위: 3·4·5·6·9 시작, 2는 MasterCard 2221~2720만
function isCardIssuerPrefix(digits: string): boolean {
  if ("34569".includes(digits[0])) return true;
  const p4 = Number(digits.slice(0, 4));
  return p4 >= 2221 && p4 <= 2720;
}

export function maskSensitive(text: string): string {
  return text
    .replace(RRN, (m, yy, mm, dd, g) =>
      isValidBirthDate(yy, mm, dd, g) && !looksLikeBarcode(m) ? "[주민번호]" : m
    )
    .replace(CARD, (m) => {
      const digits = m.replace(/\D/g, "");
      return isCardIssuerPrefix(digits) && luhn(digits) ? "[카드번호]" : m;
    });
}

/** 구조화 결과 등 JSON 직렬화 가능한 값 전체에 적용 (문자열 값만 바뀜 — 숫자·키는 그대로) */
export function maskDeep<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "string" ? maskSensitive(v) : v))
  ) as T;
}
