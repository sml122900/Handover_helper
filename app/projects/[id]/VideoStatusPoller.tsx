"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getVideoStatuses } from "./upload-actions";

const PENDING = new Set(["uploaded", "transcribing", "structuring"]);

// 처리 중인 영상이 있으면 3초마다 상태 폴링 → 변하면 화면 갱신
export function VideoStatusPoller({
  projectId,
  statuses,
}: {
  projectId: string;
  statuses: string[];
}) {
  const router = useRouter();
  const hasPending = statuses.some((s) => PENDING.has(s));

  useEffect(() => {
    if (!hasPending) return;
    const snapshot = JSON.stringify(statuses);
    const timer = setInterval(async () => {
      try {
        const latest = await getVideoStatuses(projectId);
        if (JSON.stringify(latest.map((v) => v.status)) !== snapshot) {
          router.refresh();
        }
      } catch {
        // 폴링 실패는 무시 (다음 주기에 재시도)
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [hasPending, projectId, router, statuses]);

  return null;
}
