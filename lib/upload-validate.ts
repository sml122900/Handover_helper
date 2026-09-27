// 업로드 서버 재검증 (순수 로직 — vitest 대상). 클라이언트 accept·확장자 검사는 우회 가능하므로
// 서버가 실제 저장된 객체의 선두 바이트(매직 넘버)·용량을 다시 확인한다.

export const ALLOWED_EXTS = new Set(["mp4", "webm", "m4a", "mov", "txt"]);

export const MAX_BYTES: Record<string, number> = {
  mp4: 2 * 1024 ** 3, // videos 버킷 한도와 동일
  mov: 2 * 1024 ** 3,
  webm: 2 * 1024 ** 3,
  m4a: 2 * 1024 ** 3,
  txt: 2 * 1024 ** 2, // 트랜스크립트 2MB (약 20시간 분량 한국어 발화)
};

/** 매직 넘버 확인에 필요한 선두 바이트 수 */
export const HEADER_BYTES = 16;

export type UploadCheckResult = { ok: true } | { ok: false; reason: string };

export function validateUploadedObject(args: {
  ext: string;
  sizeBytes: number;
  head: Uint8Array;
}): UploadCheckResult {
  const { ext, sizeBytes, head } = args;
  if (!ALLOWED_EXTS.has(ext)) {
    return { ok: false, reason: "지원하지 않는 형식입니다. mp4, mov, webm, m4a 또는 txt를 업로드하세요." };
  }
  if (sizeBytes <= 0) return { ok: false, reason: "빈 파일입니다. 파일을 확인하고 다시 업로드하세요." };
  if (sizeBytes > MAX_BYTES[ext]) {
    const limit = ext === "txt" ? "2MB" : "2GB";
    return { ok: false, reason: `파일이 너무 큽니다 (최대 ${limit}). 나눠서 업로드하세요.` };
  }
  if (!matchesMagic(ext, head)) {
    return {
      ok: false,
      reason: "파일 내용이 확장자와 맞지 않습니다. 원본 영상·오디오 또는 txt 파일을 다시 업로드하세요.",
    };
  }
  return { ok: true };
}

function matchesMagic(ext: string, head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  switch (ext) {
    case "mp4":
    case "mov":
    case "m4a":
      // ISO BMFF: [size 4바이트][ftyp]. 일부 mov는 moov/wide/free/mdat로 시작
      return ["ftyp", "moov", "wide", "free", "mdat"].includes(ascii(4, 8));
    case "webm":
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3; // EBML
    case "txt":
      return isUtf8Text(head);
    default:
      return false;
  }
}

// 선두 바이트가 UTF-8 텍스트인지 (NUL 없음 + 디코딩 가능). 잘린 마지막 멀티바이트 문자는 허용
function isUtf8Text(head: Uint8Array): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}
