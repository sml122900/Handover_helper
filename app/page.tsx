import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      {/* Hero */}
      <section className="text-center">
        <h1 className="text-5xl font-bold tracking-tight text-[var(--text)]">Handover</h1>
        <p className="mt-4 text-xl text-[var(--text)]">
          퇴사 전 30분 녹화로, 한 달치 인수인계를 끝내세요.
        </p>
        <p className="mt-3 text-base text-[var(--text-sub)]">
          인수인계 영상을 올리면 AI가 후임자가 바로 일할 수 있는 문서로 변환합니다.
          <br />
          사무직은 물론, 매장·현장직·알바 인수인계까지.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/login"
            className="rounded-lg bg-[var(--text)] px-7 py-3 font-medium text-[var(--bg)] hover:opacity-80"
          >
            무료로 시작하기
          </Link>
          <Link
            href="/projects"
            className="rounded-lg border border-[var(--card-border)] px-7 py-3 font-medium text-[var(--text)] hover:border-[var(--card-border-hover)]"
          >
            내 프로젝트
          </Link>
        </div>
      </section>

      {/* Pain points */}
      <section className="mt-20">
        <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-[var(--text-sub)]">
          이런 분들께
        </h2>
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              emoji: "🏪",
              title: "매장·현장직",
              desc: "포스기 비밀번호, 재고 위치, 장비 조작법—화면 밖 실물 업무도 영상 하나로 문서화.",
            },
            {
              emoji: "💻",
              title: "사무직·프리랜서",
              desc: "구두로만 전달되던 노하우와 담당자 연락처를 빠짐없이 정리.",
            },
            {
              emoji: "🎓",
              title: "단기 알바·인턴",
              desc: "짧은 근무 기간에도 다음 사람이 헤매지 않도록. 10분 녹화로 충분.",
            },
          ].map((item) => (
            <li
              key={item.title}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-5 py-5"
            >
              <div className="text-2xl">{item.emoji}</div>
              <p className="mt-2 font-semibold text-[var(--text)]">{item.title}</p>
              <p className="mt-1 text-sm text-[var(--text-sub)]">{item.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="mt-20">
        <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-[var(--text-sub)]">
          사용 방법
        </h2>
        <ol className="mt-6 flex flex-col gap-4">
          {[
            {
              step: "01",
              title: "영상 녹화 또는 업로드",
              desc: "브라우저에서 화면을 녹화하거나, 스마트폰으로 현장을 촬영해 업로드하세요.",
            },
            {
              step: "02",
              title: "AI가 자동으로 문서 생성",
              desc: "음성을 인식하고 8개 섹션(업무 개요·절차·장비·일정·연락처 등)으로 구조화합니다.",
            },
            {
              step: "03",
              title: "편집 후 링크로 공유",
              desc: "에디터에서 보완하고, 후임자에게 읽기 전용 링크를 보내세요. 로그인 없이 열람 가능.",
            },
          ].map((item) => (
            <li
              key={item.step}
              className="flex gap-5 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-5 py-4"
            >
              <span className="shrink-0 font-mono text-2xl font-bold text-[var(--accent)]">
                {item.step}
              </span>
              <div>
                <p className="font-semibold text-[var(--text)]">{item.title}</p>
                <p className="mt-1 text-sm text-[var(--text-sub)]">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section className="mt-20">
        <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-[var(--text-sub)]">
          주요 기능
        </h2>
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            "환각 없는 AI — 영상에 없는 내용은 지어내지 않음",
            "불확실한 내용은 [확인 필요] 마커로 표시",
            "AI 보완 단계는 [AI 보완] 라벨로 명확히 구분",
            "보강 질문 — 빠진 정보를 AI가 짚어줌",
            "읽기 전용 공유 링크 (만료일 설정 가능)",
            "Word(.docx) 내보내기 · 인쇄/PDF",
          ].map((f) => (
            <li
              key={f}
              className="flex gap-2 rounded-md border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text-sub)]"
            >
              <span className="text-[var(--green)]">✓</span>
              {f}
            </li>
          ))}
        </ul>
      </section>

      {/* Bottom CTA */}
      <section className="mt-20 rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-8 py-10 text-center">
        <p className="text-xl font-semibold text-[var(--text)]">지금 바로 시작하세요</p>
        <p className="mt-2 text-sm text-[var(--text-sub)]">
          Free 플랜 — 영상 총 20분까지 무료. 가입만 하면 됩니다.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-lg bg-[var(--text)] px-8 py-3 font-medium text-[var(--bg)] hover:opacity-80"
        >
          무료로 시작하기
        </Link>
      </section>
    </main>
  );
}
