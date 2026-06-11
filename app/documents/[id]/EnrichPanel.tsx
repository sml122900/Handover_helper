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
      <div className="rounded-lg border border-[#2A3140] bg-[#1A1F2B] p-4 text-sm text-[#C9C7C2]">
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
    // 에디터에 삽입 요청
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
    <div className="rounded-lg border border-[#2A3140] bg-[#1A1F2B] p-4">
      <h2 className="mb-1 text-sm font-semibold text-[#E8E6E0]">AI 보강 질문</h2>
      <p className="mb-4 text-xs text-[#C9C7C2]">
        영상에서 빠졌거나 불확실한 부분입니다. 답하면 문서에 반영됩니다.
      </p>
      <ul className="flex flex-col gap-3">
        {questions.map((q, i) => (
          <li key={i} className="rounded-md border border-[#2A3140] p-3">
            <span className="inline-block rounded-full bg-[#FFB454] px-2 py-0.5 text-[11px] font-bold text-[#1A1208]">
              {q.section}
            </span>
            <p className={`mt-1.5 text-sm ${q.answered ? "text-[#C9C7C2] line-through" : "text-[#E8E6E0]"}`}>
              {q.question}
            </p>
            {q.answered ? (
              <p className="mt-2 text-xs text-emerald-400">✓ 반영됨</p>
            ) : openIndex === i ? (
              <div className="mt-2">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="아는 대로 편하게 적어주세요. AI가 문서 문장으로 다듬어 넣습니다."
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-zinc-400 focus:outline-none"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void submit(i)}
                    disabled={busy || answer.trim().length === 0}
                    className="rounded-md bg-white px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {busy ? "반영 중…" : "문서에 반영"}
                  </button>
                  <button
                    onClick={() => {
                      setOpenIndex(null);
                      setAnswer("");
                      setError(null);
                    }}
                    className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
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
                className="mt-2 text-xs text-[#C9C7C2] underline hover:text-white"
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
