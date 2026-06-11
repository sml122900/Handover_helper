"use client";

import { useState } from "react";
import { answerEnrichQuestion } from "./actions";
import type { EnrichQuestion } from "@/lib/ai/enrich";

// AI 보강 질문 패널 — 답하면 AI가 다듬어 해당 섹션에 삽입 (DocumentEditor와 CustomEvent로 연결)
export function EnrichPanel({
  documentId,
  questions: initial,
}: {
  documentId: string;
  questions: EnrichQuestion[];
}) {
  const [questions, setQuestions] = useState(initial);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (questions.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4 text-sm text-[var(--text-sub)]">
        보강 질문이 없습니다. 문서가 충분히 채워졌거나, 질문 생성 전입니다.
      </div>
    );
  }

  async function submit(index: number) {
    setBusy(true);
    setError(null);
    const result = await answerEnrichQuestion({ documentId, questionIndex: index, answer });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("handover:append-section", {
        detail: { section: result.section, text: result.text },
      })
    );
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, answered: true } : q)));
    setOpenIndex(null);
    setAnswer("");
  }

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text)]">AI 보강 질문</h2>
      <p className="mb-4 text-xs text-[var(--text-sub)]">
        영상에서 빠졌거나 불확실한 부분입니다. 답하면 문서에 반영됩니다.
      </p>
      <ul className="flex flex-col gap-3">
        {questions.map((q, i) => (
          <li key={i} className="rounded-md border border-[var(--card-border)] p-3">
            <span className="inline-block rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-[var(--green-text)]">
              {q.section}
            </span>
            <p className={`mt-1.5 text-sm ${q.answered ? "text-[var(--text-sub)] line-through" : "text-[var(--text)]"}`}>
              {q.question}
            </p>
            {q.answered ? (
              <p className="mt-2 text-xs text-emerald-500">✓ 반영됨</p>
            ) : openIndex === i ? (
              <div className="mt-2">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="아는 대로 편하게 적어주세요. AI가 문서 문장으로 다듬어 넣습니다."
                  className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--text-sub)] focus:outline-none"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void submit(i)}
                    disabled={busy || answer.trim().length === 0}
                    className="rounded-md bg-[var(--text)] px-3 py-1 text-xs font-medium text-[var(--bg)] hover:opacity-80 disabled:opacity-50"
                  >
                    {busy ? "반영 중…" : "문서에 반영"}
                  </button>
                  <button
                    onClick={() => {
                      setOpenIndex(null);
                      setAnswer("");
                      setError(null);
                    }}
                    className="rounded-md border border-[var(--card-border)] px-3 py-1 text-xs text-[var(--text-sub)] hover:text-[var(--text)]"
                  >
                    취소
                  </button>
                </div>
                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
              </div>
            ) : (
              <button
                onClick={() => {
                  setOpenIndex(i);
                  setAnswer("");
                  setError(null);
                }}
                className="mt-2 text-xs text-[var(--text-sub)] underline hover:text-[var(--text)]"
              >
                답하기
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
