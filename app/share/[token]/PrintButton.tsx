"use client";

// PDF 내보내기 = 브라우저 인쇄 (print CSS로 다크→라이트 전환, OS 한글 폰트 사용)
// TODO(후속): 서버 사이드 PDF 생성(한글 폰트 임베드 + 키프레임 이미지) — STT 연동 후
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
    >
      PDF로 저장 / 인쇄
    </button>
  );
}
