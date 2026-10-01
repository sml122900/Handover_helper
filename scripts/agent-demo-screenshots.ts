// 에이전트 질문 화면(/agent-demo) 스크린샷 자동 생성 → docs/screenshots/
//
// 사전 준비 (터미널 2개):
//   1) npm run agent:serve                                   (에이전트 API, 127.0.0.1:8000)
//   2) NEXT_PUBLIC_AGENT_ENABLED=true npm run dev            (Next.js, localhost:3010)
// 실행: npm run screenshots:agent-demo
// 비용: 질문 4개 → Claude 호출(약 US$0.1). 질문은 골든셋 문구라 임베딩은 캐시를 써서 Voyage 0토큰에 가깝다.
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const URL = process.env.AGENT_DEMO_URL ?? "http://localhost:3010/agent-demo";
const OUT = "docs/screenshots";
const WAIT = 120_000;

async function ask(page: Page, store: string, question: string, time?: string) {
  await page.goto(URL);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // 개발 서버 표시(N 버튼) 숨김
  await page.getByText(store, { exact: true }).click();
  await page.getByRole("textbox", { name: "질문" }).fill(question);
  if (time) await page.locator('input[type="time"]').fill(time);
  await page.getByRole("button", { name: "물어보기" }).click();
  await page.getByTestId("progress").waitFor({ timeout: 10_000 });
}

// 서로 다른 문장의 첫 [근거 n]을 max개까지 펼친다 (펼침은 문장 단위)
async function openCitations(page: Page, max: number) {
  const lines = page.getByTestId("answer").locator("p").filter({ has: page.getByRole("button", { name: /^근거 \d+/ }) });
  const n = Math.min(await lines.count(), max);
  for (let i = 0; i < n; i++) await lines.nth(i).getByRole("button", { name: /^근거 \d+/ }).first().click();
  if (n === 0) console.warn("  (답변에 [근거 n]이 없음)");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const res = await fetch(URL).catch(() => null);
  if (!res || res.status !== 200) {
    throw new Error(`${URL} 에 접속할 수 없어요 (상태 ${res?.status ?? "연결 실패"}). NEXT_PUBLIC_AGENT_ENABLED=true npm run dev 로 띄웠는지 확인하세요.`);
  }
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: "ko-KR" });

    // ① 질문 → 답변 → 근거 펼침 (시각 지정 + [확인 필요] 근거가 섞이는 시각 문항)
    await ask(desktop, "한빛마트24", "손님도 없고 심심한데 지금 뭐 해야 되는 거 있어요?", "02:05");
    await desktop.getByTestId("answer").waitFor({ timeout: WAIT });
    await openCitations(desktop, 2);
    await desktop.screenshot({ path: `${OUT}/agent-demo-answer.png`, fullPage: true });
    console.log("① agent-demo-answer.png");

    // ② 쓰기 도구 확인 카드 (승인 전) → 승인 후 결과까지 동작 확인
    await ask(desktop, "달빛커피", "티라미수 2개 폐기했어요, 기록 좀 해주세요");
    const card = desktop.getByTestId("confirm-card");
    await card.waitFor({ timeout: WAIT });
    await card.getByRole("textbox").fill("유통기한 경과");
    await desktop.screenshot({ path: `${OUT}/agent-demo-confirm.png`, fullPage: true });
    await card.getByRole("button", { name: "승인하고 기록" }).click();
    await desktop.getByTestId("confirm-result").waitFor({ timeout: 30_000 });
    console.log("② agent-demo-confirm.png — 승인 결과:", await desktop.getByTestId("confirm-result").innerText());

    // ③ 문서에 없음 + 점장 확인 제안 (안전★ 문항이라 긴급 안내도 함께)
    await ask(desktop, "오름피트니스", "회원님이 운동하다가 다치셨어요");
    await desktop.getByTestId("escalation").waitFor({ timeout: WAIT });
    await desktop.screenshot({ path: `${OUT}/agent-demo-not-in-doc.png`, fullPage: true });
    console.log("③ agent-demo-not-in-doc.png");

    // ④ 모바일 390px — 답변 + 근거 펼침
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ko-KR", isMobile: true });
    await ask(mobile, "보리밭제과", "식빵이랑 바게트 안 나간 거 크림빵이랑 같이 버리면 돼요?");
    await mobile.getByTestId("answer").waitFor({ timeout: WAIT });
    await openCitations(mobile, 1);
    await mobile.screenshot({ path: `${OUT}/agent-demo-mobile.png`, fullPage: true });
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log("④ agent-demo-mobile.png — 가로 넘침:", overflow);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
