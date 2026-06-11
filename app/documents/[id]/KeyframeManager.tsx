"use client";

import { useEffect, useState } from "react";
import { getKeyframesForDocument, setKeyframeForStep } from "./keyframe-actions";
import type { KeyframeItem } from "./keyframe-actions";

interface ProcedureRef {
  step: number;
  title: string;
  keyframeId: string | null;
}

// 절차 단계별 키프레임 관리 패널
// 변경 시 handover:set-content CustomEvent로 DocumentEditor에 새 HTML 전달
export function KeyframeManager({
  documentId,
  procedures: initialProcedures,
}: {
  documentId: string;
  procedures: ProcedureRef[];
}) {
  const [procedures, setProcedures] = useState(initialProcedures);
  const [allFrames, setAllFrames] = useState<KeyframeItem[]>([]);
  const [pickerStep, setPickerStep] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getKeyframesForDocument(documentId).then(setAllFrames);
  }, [documentId]);

  if (procedures.length === 0) return null;

  async function assign(step: number, keyframeId: string | null) {
    setBusy(step);
    setError(null);
    const result = await setKeyframeForStep(documentId, step, keyframeId);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setProcedures((ps) => ps.map((p) => (p.step === step ? { ...p, keyframeId } : p)));
    setPickerStep(null);
    window.dispatchEvent(new CustomEvent("handover:set-content", { detail: result.newHtml }));
  }

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text)]">절차 키프레임</h2>
      <p className="mb-3 text-xs text-[var(--text-sub)]">절차 단계에 영상 화면을 첨부합니다.</p>

      <ul className="flex flex-col gap-3">
        {procedures.map((p) => (
          <li key={p.step} className="rounded-md border border-[var(--card-border)] p-2">
            <p className="mb-1 text-xs font-medium text-[var(--text)]">
              {p.step}. {p.title}
            </p>

            {p.keyframeId ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/keyframes/${p.keyframeId}`}
                  alt="키프레임"
                  className="h-20 w-auto rounded border border-[var(--card-border)] object-cover"
                />
                <div className="absolute right-0 top-0 flex gap-1">
                  <button
                    onClick={() => setPickerStep(p.step)}
                    className="rounded bg-[var(--bg)]/80 p-0.5 text-[10px] text-[var(--text)] hover:bg-[var(--card-border)]"
                    title="다른 프레임으로 교체"
                    disabled={busy === p.step}
                  >
                    🔄
                  </button>
                  <button
                    onClick={() => void assign(p.step, null)}
                    className="rounded bg-[var(--bg)]/80 p-0.5 text-[10px] text-red-400 hover:bg-[var(--card-border)]"
                    title="이미지 삭제"
                    disabled={busy === p.step}
                  >
                    ×
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setPickerStep(p.step)}
                className="text-xs text-[var(--text-sub)] underline hover:text-[var(--text)]"
                disabled={allFrames.length === 0}
              >
                {allFrames.length === 0 ? "키프레임 없음" : "+ 이미지 추가"}
              </button>
            )}

            {busy === p.step && (
              <p className="mt-1 text-xs text-[var(--text-sub)]">저장 중…</p>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {/* 키프레임 선택 팝업 */}
      {pickerStep !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="max-h-[80vh] w-[90vw] max-w-lg overflow-y-auto rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--text)]">
                프레임 선택 — 단계 {pickerStep}
              </p>
              <button
                onClick={() => setPickerStep(null)}
                className="text-[var(--text-sub)] hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>
            {allFrames.length === 0 ? (
              <p className="text-sm text-[var(--text-sub)]">추출된 키프레임이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {allFrames.map((kf) => (
                  <button
                    key={kf.id}
                    onClick={() => void assign(pickerStep, kf.id)}
                    className="overflow-hidden rounded border-2 border-transparent hover:border-[var(--accent)] focus:border-[var(--accent)]"
                    title={`${Math.floor(kf.timestampSeconds / 60)}:${String(Math.floor(kf.timestampSeconds % 60)).padStart(2, "0")}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={kf.imgUrl}
                      alt={`${kf.timestampSeconds}s`}
                      className="h-20 w-full object-cover"
                    />
                    <p className="bg-[var(--bg)] py-0.5 text-center text-[10px] text-[var(--text-sub)]">
                      {Math.floor(kf.timestampSeconds / 60)}:{String(Math.floor(kf.timestampSeconds % 60)).padStart(2, "0")}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
