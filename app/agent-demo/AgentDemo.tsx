"use client";

import { useEffect, useState } from "react";
import { DEMO_STORES, cleanSnippet, isNotInDocLine, parseLine, type AgentReply, type Citation } from "@/lib/agent-demo";

// 응답 대기 단계 안내 — 스트리밍이 없어 실제 진행 신호가 아니라 경과 시간 기준의 예상 단계다 (p50 약 13초)
const STAGES = [
  { at: 0, text: "질문 종류를 파악하는 중" },
  { at: 3, text: "문서에서 근거를 찾는 중" },
  { at: 7, text: "근거를 확인하고 답변을 쓰는 중" },
];
const TOOL_LABEL: Record<string, string> = {
  waste_log: "폐기 대장 기록",
  log_checklist: "체크리스트 완료 기록",
  notify_manager: "점장 알림 (모의 발송)",
};
const STATUS_BADGE: Record<string, string> = {
  no_tasks: "지금·곧 일정 없음",
  out_of_scope: "범위 밖 질문",
  clarify: "되묻기",
  duplicate: "이미 기록됨",
  tool_result: "기록 조회",
};

function seoulNow(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

async function post(path: string, body: unknown): Promise<AgentReply> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "요청을 처리하지 못했어요. 다시 시도해 주세요.");
  return data as AgentReply;
}

export function AgentDemo() {
  const [storeId, setStoreId] = useState<string>("s1");
  const [question, setQuestion] = useState("");
  const [time, setTime] = useState("");
  const [now, setNow] = useState("");
  const [asking, setAsking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reply, setReply] = useState<AgentReply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(seoulNow());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!asking) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [asking]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setElapsed(0);
    setReply(null);
    setError(null);
    try {
      setReply(
        await post("/api/agent-demo/ask", {
          store_id: storeId,
          question: question.trim(),
          ...(time ? { current_time: time } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청을 처리하지 못했어요.");
    } finally {
      setAsking(false);
    }
  }

  const store = DEMO_STORES.find((s) => s.id === storeId)!;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-[var(--text)]">업무 도우미 데모</h1>
          <span className="rounded-full border border-[var(--accent)] bg-[var(--accent-bg)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
            가상 데이터
          </span>
          <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-xs text-[var(--text-sub)]">
            로컬 데모 전용
          </span>
        </div>
        <p className="text-sm text-[var(--text-sub)]">
          인수인계 문서에 근거해 답하고, 근거가 없으면 &ldquo;문서에 없어요&rdquo;라고 말해요. 이 화면의 매장·문서는 모두 가상
          데이터이며 실제 매장·인물과 무관합니다.
        </p>
      </header>

      <form onSubmit={ask} className="mb-6 flex flex-col gap-4 rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-[var(--text)]">매장 (가상)</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {DEMO_STORES.map((s) => (
              <label
                key={s.id}
                className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                  s.id === storeId
                    ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--text)]"
                    : "border-[var(--card-border)] text-[var(--text-sub)] hover:border-[var(--card-border-hover)]"
                }`}
              >
                <input
                  type="radio"
                  name="store"
                  value={s.id}
                  checked={s.id === storeId}
                  onChange={() => setStoreId(s.id)}
                  className="sr-only"
                />
                <span className="block font-medium">{s.name}</span>
                <span className="block text-xs">{s.kind}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
          질문
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={`${store.name}에서 궁금한 업무를 물어보세요. 예: 마감 때 돈이 안 맞으면 어디에 말해요?`}
            className="resize-y rounded-md border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-sub)] focus:border-[var(--text-sub)] focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
            지금 시각 (데모용)
            <span className="flex items-center gap-2">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-describedby="time-help"
                className="rounded-md border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
              />
              {time && (
                <button type="button" onClick={() => setTime("")} className="text-xs text-[var(--text-sub)] underline">
                  현재 시각으로
                </button>
              )}
            </span>
            <span id="time-help" className="text-xs text-[var(--text-sub)]">
              {time ? `${time} 기준으로 답해요` : `비워 두면 현재 서울 시각${now ? ` (${now})` : ""} 기준`}
            </span>
          </label>
          <button
            disabled={asking || !question.trim()}
            className="rounded-md bg-[var(--text)] px-5 py-2 font-medium text-[var(--bg)] hover:opacity-80 disabled:opacity-40"
          >
            {asking ? "답변 기다리는 중…" : "물어보기"}
          </button>
        </div>
      </form>

      <section aria-live="polite">
        {asking && <Progress elapsed={elapsed} />}
        {error && (
          <p role="alert" className="rounded-lg border border-red-400/50 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        )}
        {reply && <Reply key={reply.thread_id} reply={reply} />}
      </section>
    </main>
  );
}

function Progress({ elapsed }: { elapsed: number }) {
  const current = STAGES.filter((s) => elapsed >= s.at).length - 1;
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4" data-testid="progress">
      <ol className="flex flex-col gap-1.5 text-sm">
        {STAGES.map((s, i) => (
          <li key={s.text} className={i <= current ? "text-[var(--text)]" : "text-[var(--text-sub)] opacity-60"}>
            <span className="mr-2 inline-block w-4">{i < current ? "✓" : i === current ? <Spinner /> : "·"}</span>
            {s.text}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-[var(--text-sub)]">
        {elapsed}초 · 보통 10~20초 걸려요. 단계는 경과 시간 기준의 예상 안내예요.
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent align-middle" />
  );
}

function Reply({ reply }: { reply: AgentReply }) {
  if (reply.status === "failed") {
    return (
      <p role="alert" className="rounded-lg border border-red-400/50 px-4 py-3 text-sm text-red-400">
        {reply.answer}
      </p>
    );
  }
  if (reply.status === "escalated" && reply.escalation) return <Escalation esc={reply.escalation} />;
  if (reply.status === "needs_confirmation" && reply.confirmation) return <ConfirmCard reply={reply} />;
  const badge = STATUS_BADGE[reply.status];
  return (
    <article className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4" data-testid="answer">
      {badge && (
        <span className="mb-2 inline-block rounded-full border border-[var(--card-border)] px-2 py-0.5 text-xs text-[var(--text-sub)]">
          {badge}
        </span>
      )}
      <AnswerBody answer={reply.answer} citations={reply.citations} />
    </article>
  );
}

function AnswerBody({ answer, citations }: { answer: string; citations: Citation[] }) {
  // 펼침 상태는 "줄:근거 번호" 단위 — 누른 문장 바로 아래에만 근거 조각을 펼친다
  const [open, setOpen] = useState<Set<string>>(new Set());
  const byN = new Map(citations.map((c) => [c.n, c]));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-1.5 text-[15px] leading-relaxed text-[var(--text)]">
      {answer.split("\n").map((raw, i) => {
        if (!raw.trim()) return <div key={i} className="h-1" />;
        if (raw.trim() === "---") return <hr key={i} className="my-2 border-[var(--card-border)]" />;
        const quote = raw.startsWith("> ");
        const line = quote ? raw.slice(2) : raw;
        const pieces = parseLine(line);
        const cited = [...new Set(pieces.flatMap((p) => (p.kind === "cite" ? [p.n] : [])))];
        const notInDoc = isNotInDocLine(line);
        return (
          <div key={i}>
            <p
              className={
                notInDoc
                  ? "border-l-2 border-dashed border-[var(--text-sub)] pl-3 text-[var(--text-sub)]"
                  : quote
                    ? "border-l-2 border-[var(--card-border-hover)] pl-3"
                    : undefined
              }
            >
              {pieces.map((p, j) => {
                if (p.kind === "text") return <span key={j}>{p.text}</span>;
                if (p.kind === "bold") return <strong key={j}>{p.text}</strong>;
                if (p.kind === "check") return <CheckLabel key={j} />;
                const c = byN.get(p.n);
                const key = `${i}:${p.n}`;
                return (
                  <button
                    key={j}
                    type="button"
                    onClick={() => toggle(key)}
                    aria-expanded={open.has(key)}
                    className={`mx-0.5 inline-flex items-center rounded border px-1.5 py-0 align-baseline text-xs ${
                      open.has(key)
                        ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]"
                        : "border-[var(--card-border)] text-[var(--text-sub)] hover:border-[var(--card-border-hover)]"
                    }`}
                  >
                    근거 {p.n}
                    {c?.needs_check && <span className="ml-1 text-[var(--accent)]">· 확인 필요</span>}
                  </button>
                );
              })}
            </p>
            {cited
              .filter((n) => open.has(`${i}:${n}`))
              .map((n) => (
                <EvidencePanel key={n} n={n} c={byN.get(n)} />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function CheckLabel() {
  return (
    <span className="mx-0.5 rounded bg-[var(--accent-bg)] px-1 text-xs font-medium text-[var(--accent)]">[확인 필요]</span>
  );
}

function EvidencePanel({ n, c }: { n: number; c?: Citation }) {
  return (
    <div className="my-2 rounded-md border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2 text-sm" data-testid="evidence">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-sub)]">
        <span className="font-medium text-[var(--text)]">근거 {n}</span>
        <span>{c?.label ?? "출처 정보 없음"}</span>
        {c?.needs_check && <CheckLabel />}
      </div>
      {c?.text ? (
        <p className="whitespace-pre-wrap text-[var(--text-sub)]">{cleanSnippet(c.text)}</p>
      ) : (
        <p className="text-[var(--text-sub)]">근거 조각을 불러오지 못했어요.</p>
      )}
      {c?.needs_check && (
        <p className="mt-1 text-xs text-[var(--accent)]">AI가 보완했거나 확인이 필요한 항목이에요. 점장님께 확인해 보세요.</p>
      )}
    </div>
  );
}

function Escalation({ esc }: { esc: NonNullable<AgentReply["escalation"]> }) {
  return (
    <div className="flex flex-col gap-3" data-testid="escalation">
      <div className="rounded-lg border border-dashed border-[var(--card-border-hover)] p-4">
        <span className="mb-2 inline-block rounded-full border border-[var(--card-border-hover)] px-2 py-0.5 text-xs font-medium text-[var(--text-sub)]">
          문서에 없음
        </span>
        <p className="text-[var(--text)]">{esc.not_in_doc}</p>
        <p className="mt-1 text-xs text-[var(--text-sub)]">추측해서 답하지 않아요.</p>
      </div>
      <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-bg)] p-4">
        <p className="mb-1 text-sm font-medium text-[var(--accent)]">점장 확인 제안</p>
        <p className="text-sm text-[var(--text)]">점장님께 이렇게 확인을 요청해 보세요:</p>
        <p className="mt-2 rounded-md bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">{esc.manager_request}</p>
      </div>
      {esc.emergency && (
        <p role="alert" className="rounded-lg border border-red-400/60 px-4 py-3 text-sm text-red-400">
          {esc.emergency}
        </p>
      )}
    </div>
  );
}

function ConfirmCard({ reply }: { reply: AgentReply }) {
  const conf = reply.confirmation!;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentReply | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await post("/api/agent-demo/confirm", {
          thread_id: reply.thread_id,
          approve,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청을 처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--accent)] bg-[var(--card)] p-4" data-testid="confirm-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
          기록 전 확인
        </span>
        <span className="text-sm text-[var(--text-sub)]">{TOOL_LABEL[conf.tool] ?? conf.tool}</span>
      </div>
      <p className="whitespace-pre-wrap text-[var(--text)]">{conf.text}</p>
      {conf.tool === "waste_log" && !result && (
        <label className="mt-3 flex flex-col gap-1 text-sm text-[var(--text)]">
          사유 (선택)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="예: 유통기한 경과 — 비워 두면 '사유 미기재'로 저장돼요"
            className="rounded-md border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-sub)] focus:border-[var(--text-sub)] focus:outline-none"
          />
        </label>
      )}
      {!result ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="rounded-md bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-80 disabled:opacity-40"
          >
            승인하고 기록
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="rounded-md border border-[var(--card-border)] px-4 py-2 text-sm text-[var(--text-sub)] hover:border-[var(--card-border-hover)] hover:text-[var(--text)] disabled:opacity-40"
          >
            거절
          </button>
        </div>
      ) : (
        <p
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            result.status === "tool_done" ? "bg-[var(--accent-bg)] text-[var(--text)]" : "text-[var(--text-sub)]"
          }`}
          data-testid="confirm-result"
        >
          {result.answer}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-[var(--text-sub)]">승인해야만 저장돼요. 기본 설정에서는 기록이 에이전트 서버 메모리에만 남고 재시작하면 사라져요.</p>
    </div>
  );
}
