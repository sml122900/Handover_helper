"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { saveDocumentHtml } from "./actions";

type SaveState = "saved" | "saving" | "dirty" | "error";

// Tiptap 에디터 — 8섹션 HTML 자유 편집 + 2초 디바운스 자동 저장
export function DocumentEditor({
  documentId,
  initialHtml,
}: {
  documentId: string;
  initialHtml: string;
}) {
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, Highlight],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "max-w-none min-h-[60vh] rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-6 py-4 text-sm leading-relaxed focus:outline-none " +
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1 " +
          // needs_review·AI 보완: 왼쪽 3px 보더 + 옅은 배경 (테마별 --accent, --accent-bg 사용)
          "[&_mark]:bg-[var(--accent-bg)] [&_mark]:text-[var(--text)] [&_mark]:border-l-[3px] [&_mark]:border-l-[var(--accent)] [&_mark]:pl-2 [&_mark]:py-0.5 [&_mark]:rounded-r " +
          "[&_h2]:text-[var(--text)] [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold " +
          // 타임스탬프(em): accent색 + 작은 이탤릭
          "[&_em]:text-xs [&_em]:italic [&_em]:text-[var(--accent)] " +
          // [AI 보완] 라벨(code): 초록 테두리형 pill
          "[&_code]:rounded-full [&_code]:border [&_code]:border-[var(--green)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:font-bold [&_code]:text-[var(--green)] " +
          "[&_p]:text-[var(--text)] [&_li]:text-[var(--text)] [&_strong]:text-[var(--text)]",
      },
    },
    onUpdate: () => {
      setSaveState("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(save, 2000);
    },
  });

  async function save() {
    if (!editor) return;
    setSaveState("saving");
    const result = await saveDocumentHtml(documentId, editor.getHTML());
    setSaveState(result.ok ? "saved" : "error");
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    function onAppend(e: Event) {
      const { section, text } = (e as CustomEvent<{ section: string; text: string }>).detail;
      if (!editor) return;
      appendToSection(editor, section, text);
      setSaveState("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(save, 2000);
    }
    window.addEventListener("handover:append-section", onAppend);
    return () => window.removeEventListener("handover:append-section", onAppend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const label: Record<SaveState, string> = {
    saved: "저장됨",
    saving: "저장 중…",
    dirty: "수정됨 (자동 저장 대기)",
    error: "저장 실패 — 네트워크 확인",
  };

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <span
          className={`text-xs ${saveState === "error" ? "text-red-400" : "text-[var(--text-sub)]"}`}
        >
          {label[saveState]}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

// 해당 섹션 h2를 찾아 그 섹션 끝에 보강 문장을 리스트 항목으로 삽입
function appendToSection(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  section: string,
  text: string
) {
  const html = editor.getHTML();
  const headings = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)];
  const target = headings.find((h) => h[1].includes(section));

  const insertion = `<ul><li>${text} <em>(보강 답변)</em></li></ul>`;
  if (!target) {
    editor.commands.insertContentAt(editor.state.doc.content.size, insertion);
    return;
  }
  const next = headings[headings.indexOf(target) + 1];
  const insertHtmlIndex = next ? html.indexOf(next[0]) : html.length;
  const newHtml = html.slice(0, insertHtmlIndex) + insertion + html.slice(insertHtmlIndex);
  editor.commands.setContent(newHtml);
}
