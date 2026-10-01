import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AGENT_DEMO_ENABLED } from "@/lib/agent-demo";
import { AgentDemo } from "./AgentDemo";

export const metadata: Metadata = { title: "업무 도우미 데모 — Handover" };

// 로컬 데모 전용: NEXT_PUBLIC_AGENT_ENABLED=true일 때만 열린다 (프로덕션 기본 꺼짐 → 404)
export default function AgentDemoPage() {
  if (!AGENT_DEMO_ENABLED) notFound();
  return <AgentDemo />;
}
