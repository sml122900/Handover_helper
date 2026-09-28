import { describeProgress, type StepState } from "@/lib/pipeline/progress";

const DOT: Record<StepState, string> = {
  done: "bg-emerald-500",
  active: "bg-amber-400 animate-pulse",
  pending: "bg-[var(--card-border)]",
  failed: "bg-red-500",
};

const TEXT: Record<StepState, string> = {
  done: "text-[var(--text)]",
  active: "text-[var(--text)] font-medium",
  pending: "text-[var(--text-sub)]",
  failed: "text-red-400 font-medium",
};

// 처리 단계 표시: 업로드 → 음성 인식 → 구조화 → 보강 질문 (+ 현재 세부 단계·남은 예상 시간)
export function VideoProgress(props: {
  status: string;
  stage: string | null;
  durationSeconds: number | null;
  isText: boolean;
}) {
  const { steps, detail, eta } = describeProgress(props);
  return (
    <div className="mt-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="처리 단계">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-[var(--text-sub)]" aria-hidden>→</span>}
            <span className={`inline-block h-2 w-2 rounded-full ${DOT[s.state]}`} aria-hidden />
            <span className={TEXT[s.state]}>
              {s.label}
              <span className="sr-only">
                {s.state === "done" ? " 완료" : s.state === "active" ? " 진행 중" : s.state === "failed" ? " 실패" : " 대기"}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {(detail || eta) && (
        <p className="mt-1 text-xs text-[var(--text-sub)]">{[detail, eta].filter(Boolean).join(" · ")}</p>
      )}
    </div>
  );
}
