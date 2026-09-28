"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getVideoStatuses } from "./upload-actions";
import { POLL_MIN_MS, nextPollDelay } from "@/lib/pipeline/progress";

const snapshotOf = (rows: { id: string; status: string; stage: string | null; error_message: string | null }[]) =>
  rows.map((v) => `${v.id}:${v.status}:${v.stage ?? ""}:${v.error_message ?? ""}`).join("|");

// 처리 중인 영상이 있으면 상태 폴링 → 변하면 화면 갱신
// 간격: 변화 있으면 3초, 없으면 1.5배씩 최대 15초 / 탭이 숨겨지면 중지, 돌아오면 즉시 조회
export function VideoStatusPoller({
  projectId,
  snapshot,
  hasPending,
}: {
  projectId: string;
  snapshot: string;
  hasPending: boolean;
}) {
  const router = useRouter();
  const delayRef = useRef(POLL_MIN_MS);

  useEffect(() => {
    if (!hasPending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const poll = async () => {
      timer = undefined;
      if (stopped || document.visibilityState === "hidden") return;
      let changed = false;
      try {
        const latest = await getVideoStatuses(projectId);
        changed = snapshotOf(latest) !== snapshot;
        if (changed) router.refresh();
      } catch {
        // 폴링 실패는 무시 (다음 주기에 재시도)
      }
      delayRef.current = nextPollDelay(delayRef.current, changed);
      // 변화 시 router.refresh → 새 snapshot으로 effect 재실행(이 타이머는 cleanup에서 해제). 경합 대비 항상 다음 주기 예약
      if (!stopped) timer = setTimeout(poll, delayRef.current);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !timer) {
        delayRef.current = POLL_MIN_MS;
        void poll();
      }
    };

    timer = setTimeout(poll, delayRef.current);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasPending, projectId, router, snapshot]);

  return null;
}
