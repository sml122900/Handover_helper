// 영상 처리 진행 표시 (순수 로직 — vitest 대상)
// status = 기존 상태머신, stage = 세부 단계(0009, 없으면 null → status만으로 표시)

export type StepKey = "upload" | "stt" | "structure" | "enrich";
export type StepState = "done" | "active" | "pending" | "failed";

export const STEP_LABELS: Record<StepKey, string> = {
  upload: "업로드",
  stt: "음성 인식",
  structure: "구조화",
  enrich: "보강 질문",
};

const ORDER: StepKey[] = ["upload", "stt", "structure", "enrich"];

// 단계별 예상 시간 (초) — 세션 3-A② 로컬 실측(PROGRESS.md 표) 기준. 영상 길이 비례 + 고정분
// 실측: 30분 영상 오디오 추출 7.4초·키프레임 6.9초, 구조화 93~95초, 보강 질문 15~18초
// STT는 미실측(Groq 키 무효) — 영상 1초당 0.05초(30분 ≈ 90초)로 보수적 가정, 실측 후 조정
export const ESTIMATE = {
  sttPerVideoSecond: 0.06, // 오디오 추출·키프레임(≈0.008) + STT 가정치(0.05)
  sttFixed: 20,
  structure: 100,
  enrich: 20,
};

export interface ProgressInput {
  status: string;
  stage: string | null;
  durationSeconds: number | null;
  isText: boolean;
}

export interface Progress {
  steps: { key: StepKey; label: string; state: StepState }[];
  /** 현재 단계 세부 설명 (예: "음성 인식 2/3") */
  detail: string | null;
  /** 남은 예상 시간 안내 (처리 중일 때만) */
  eta: string | null;
}

function activeStep(status: string, stage: string | null): StepKey | null {
  if (status === "uploaded") return "upload";
  if (status === "transcribing") return "stt";
  if (status === "structuring") return stage === "enriching" ? "enrich" : "structure";
  return null;
}

function failedStep(stage: string | null): StepKey | null {
  if (!stage) return null; // 0009 전이거나 단계 정보 없음 → 사유 문구만 표시
  if (stage === "audio" || stage === "keyframes" || stage.startsWith("stt")) return "stt";
  if (stage === "structuring") return "structure";
  if (stage === "enriching") return "enrich";
  return null;
}

function stageDetail(stage: string | null, isText: boolean): string | null {
  if (isText) return null;
  if (stage === "audio") return "오디오 추출 중";
  const stt = stage?.match(/^stt:(\d+)\/(\d+)$/);
  if (stt) return `음성 인식 ${stt[1]}/${stt[2]}`;
  if (stage === "keyframes") return "화면 캡처 추출 중";
  return null;
}

function remainingSeconds(from: StepKey, input: ProgressInput): number {
  const duration = input.durationSeconds ?? 0;
  const cost: Record<StepKey, number> = {
    upload: 0,
    stt: input.isText ? 0 : ESTIMATE.sttFixed + duration * ESTIMATE.sttPerVideoSecond,
    structure: ESTIMATE.structure,
    enrich: ESTIMATE.enrich,
  };
  return ORDER.slice(ORDER.indexOf(from)).reduce((sum, k) => sum + cost[k], 0);
}

function formatEta(seconds: number): string {
  return seconds < 90 ? "1분 안팎 남음" : `약 ${Math.round(seconds / 60)}분 남음`;
}

export function describeProgress(input: ProgressInput): Progress {
  const { status, stage, isText } = input;
  if (status === "done") {
    return { steps: ORDER.map((key) => ({ key, label: STEP_LABELS[key], state: "done" })), detail: null, eta: null };
  }
  if (status === "failed") {
    const failed = failedStep(stage);
    const failedIdx = failed ? ORDER.indexOf(failed) : -1;
    return {
      steps: ORDER.map((key, i) => ({
        key,
        label: STEP_LABELS[key],
        state: failedIdx < 0 ? (i === 0 ? "done" : "pending") : i < failedIdx ? "done" : i === failedIdx ? "failed" : "pending",
      })),
      detail: null,
      eta: null,
    };
  }
  const active = activeStep(status, stage) ?? "upload";
  const activeIdx = ORDER.indexOf(active);
  return {
    steps: ORDER.map((key, i) => ({
      key,
      label: STEP_LABELS[key],
      state: i < activeIdx ? "done" : i === activeIdx ? "active" : "pending",
    })),
    detail: status === "uploaded" ? "변환 대기 중" : active === "stt" ? stageDetail(stage, isText) : null,
    eta: formatEta(remainingSeconds(active === "upload" ? "stt" : active, input)),
  };
}

// 폴링 간격: 변화가 있으면 3초로 리셋, 없으면 1.5배씩 늘려 최대 15초
export const POLL_MIN_MS = 3000;
export const POLL_MAX_MS = 15000;
export function nextPollDelay(currentMs: number, changed: boolean): number {
  return changed ? POLL_MIN_MS : Math.min(Math.round(currentMs * 1.5), POLL_MAX_MS);
}
