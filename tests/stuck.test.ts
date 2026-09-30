import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStuck, stuckThresholdMs, STUCK_UPLOADED_MS, STUCK_PROCESSING_MIN_MS } from "../lib/pipeline/stuck";
import { claimAndEnqueueRetry, claimStuckAndEnqueue, ENQUEUE_FAILED_MESSAGE } from "../lib/pipeline/retry";

const T0 = Date.parse("2026-09-30T00:00:00Z");
const base = { stage: null, durationSeconds: 600, isText: false };
const at = (msAgo: number) => new Date(T0 - msAgo).toISOString();

describe("isStuck 경계값", () => {
  it("uploaded: 5분 정각은 정상, 1ms 초과부터 멈춤", () => {
    expect(isStuck({ ...base, status: "uploaded", statusChangedAt: at(STUCK_UPLOADED_MS) }, T0)).toBe(false);
    expect(isStuck({ ...base, status: "uploaded", statusChangedAt: at(STUCK_UPLOADED_MS + 1) }, T0)).toBe(true);
  });

  it("짧은 영상 transcribing/structuring: 최소 15분 경계", () => {
    for (const status of ["transcribing", "structuring"]) {
      expect(stuckThresholdMs({ ...base, status })).toBe(STUCK_PROCESSING_MIN_MS);
      expect(isStuck({ ...base, status, statusChangedAt: at(STUCK_PROCESSING_MIN_MS) }, T0)).toBe(false);
      expect(isStuck({ ...base, status, statusChangedAt: at(STUCK_PROCESSING_MIN_MS + 1) }, T0)).toBe(true);
    }
  });

  it("긴 영상: 예상 소요 × 3이 15분보다 크면 그 값이 기준", () => {
    // 3시간 영상: stt 예상 = 20 + 10800×0.06 + 100 + 20 = 788초 → ×3 = 2364초 (39.4분)
    const long = { ...base, status: "transcribing", durationSeconds: 10800 };
    const threshold = stuckThresholdMs(long)!;
    expect(threshold).toBeGreaterThan(STUCK_PROCESSING_MIN_MS);
    expect(isStuck({ ...long, statusChangedAt: at(threshold) }, T0)).toBe(false);
    expect(isStuck({ ...long, statusChangedAt: at(threshold + 1) }, T0)).toBe(true);
  });

  it("done·failed·시각 없음(0011 미적용)·잘못된 시각은 멈춤 아님", () => {
    expect(isStuck({ ...base, status: "done", statusChangedAt: at(1e9) }, T0)).toBe(false);
    expect(isStuck({ ...base, status: "failed", statusChangedAt: at(1e9) }, T0)).toBe(false);
    expect(isStuck({ ...base, status: "uploaded", statusChangedAt: null }, T0)).toBe(false);
    expect(isStuck({ ...base, status: "uploaded", statusChangedAt: "nope" }, T0)).toBe(false);
  });
});

// 조건부 update 흉내 (retry-claim.test.ts와 같은 방식)
function fakeDb(row: Record<string, unknown>) {
  const db = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const filters: [string, unknown][] = [];
        const match = () => filters.every(([c, v]) => row[c] === v);
        const q = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return q;
          },
          async select() {
            await Promise.resolve();
            if (!match()) return { data: [], error: null };
            Object.assign(row, patch);
            return { data: [{ id: row.id }], error: null };
          },
          then(resolve: (v: { error: null }) => void) {
            if (match()) Object.assign(row, patch);
            resolve({ error: null });
          },
        };
        return q;
      },
    }),
  };
  return db as unknown as SupabaseClient;
}

describe("claimStuckAndEnqueue", () => {
  const observed = { status: "transcribing", statusChangedAt: "t1" };
  const mk = () => ({ id: "v1", status: "transcribing", status_changed_at: "t1", stage: "stt:1/3", error_message: null });

  it("멈춘 영상 → uploaded + 재시도 키로 1회 enqueue", async () => {
    const row = mk();
    const enqueue = vi.fn(async () => {});
    expect(await claimStuckAndEnqueue(fakeDb(row), "v1", observed, enqueue, () => 7)).toBe(true);
    expect(row).toMatchObject({ status: "uploaded", stage: null });
    expect(enqueue).toHaveBeenCalledExactlyOnceWith("v1:retry-7");
  });

  it("중복 클릭(동시 2회) → 1건만 통과", async () => {
    const db = fakeDb(mk());
    const enqueue = vi.fn(async () => {});
    const r = await Promise.all([
      claimStuckAndEnqueue(db, "v1", observed, enqueue),
      claimStuckAndEnqueue(db, "v1", observed, enqueue),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("그 사이 상태가 바뀌었으면(정상 진행) 재시도 안 함", async () => {
    const row = { ...mk(), status_changed_at: "t2" };
    const enqueue = vi.fn(async () => {});
    expect(await claimStuckAndEnqueue(fakeDb(row), "v1", observed, enqueue)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueue 실패 → failed + 사유 저장 + 에러 콜백(Sentry)", async () => {
    const row = mk();
    const boom = new Error("inngest down");
    const onErr = vi.fn();
    await claimStuckAndEnqueue(fakeDb(row), "v1", observed, async () => { throw boom; }, () => 1, onErr);
    expect(row).toMatchObject({ status: "failed", error_message: ENQUEUE_FAILED_MESSAGE });
    expect(onErr).toHaveBeenCalledExactlyOnceWith(boom);
  });

  it("failed 재시도도 enqueue 실패 시 failed 복귀 + 콜백", async () => {
    const row = { ...mk(), status: "failed" };
    const onErr = vi.fn();
    await claimAndEnqueueRetry(fakeDb(row), "v1", async () => { throw new Error("x"); }, () => 1, onErr);
    expect(row).toMatchObject({ status: "failed", error_message: ENQUEUE_FAILED_MESSAGE });
    expect(onErr).toHaveBeenCalledTimes(1);
  });
});
