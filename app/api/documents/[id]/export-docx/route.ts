import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocumentSchema } from "@/lib/ai/schema";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
} from "docx";

interface ProcedureRaw {
  step: number;
  title: string;
  details: string;
  keyframeId?: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: doc } = await supabase
    .from("documents")
    .select("id, project_id, content")
    .eq("id", id)
    .single();
  if (!doc) return new NextResponse("Not Found", { status: 404 });

  const parsed = DocumentSchema.safeParse(doc.content);
  if (!parsed.success) return new NextResponse("Invalid document", { status: 400 });
  const document = parsed.data;

  // raw content로 keyframeIds 추출
  const rawContent = doc.content as { procedures?: ProcedureRaw[] } | null;
  const keyframeIds: Record<number, string> = {};
  for (const p of rawContent?.procedures ?? []) {
    if (p.keyframeId) keyframeIds[p.step] = p.keyframeId;
  }

  // 키프레임 이미지 다운로드 (image_path → Storage 바이트)
  const admin = createAdminClient();
  const imageBuffers: Record<number, Buffer> = {};

  for (const [stepStr, keyframeId] of Object.entries(keyframeIds)) {
    const step = Number(stepStr);
    const { data: kf } = await admin
      .from("keyframes")
      .select("image_path")
      .eq("id", keyframeId)
      .single();
    if (!kf?.image_path) continue;
    const { data: file } = await admin.storage.from("keyframes").download(kf.image_path);
    if (file) imageBuffers[step] = Buffer.from(await file.arrayBuffer());
  }

  // docx 빌드
  const children: Paragraph[] = [
    new Paragraph({
      text: "인수인계 문서",
      heading: HeadingLevel.TITLE,
    }),
  ];

  // 1. 업무 개요
  children.push(new Paragraph({ text: "1. 업무 개요", heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ children: [new TextRun({ text: document.overview.summary })] }));
  if (document.overview.cycle)
    children.push(new Paragraph({ children: [new TextRun({ text: `주기: ${document.overview.cycle}` })] }));

  // 2. 절차
  children.push(new Paragraph({ text: "2. 절차", heading: HeadingLevel.HEADING_1 }));
  for (const p of document.procedures) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${p.step}. ${p.title}`, bold: true }),
          new TextRun({ text: `  —  ${p.details}` }),
          ...(p.inferred ? [new TextRun({ text: " [AI 보완]", color: "1a7a45" })] : []),
        ],
      })
    );
    if (imageBuffers[p.step]) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new ImageRun({
              data: imageBuffers[p.step],
              transformation: { width: 400, height: 225 },
              type: "jpg",
            }),
          ],
        })
      );
    }
  }

  // 3~8. 나머지 섹션 (텍스트만)
  const sections: [string, string[]][] = [
    ["3. 장비·위치·물품", document.equipment.map((e) => `${e.name}${e.location ? ` — ${e.location}` : ""}${e.notes ? ` · ${e.notes}` : ""}`)],
    ["4. 일정·루틴", document.routines.map((r) => `${r.when} — ${r.title}${r.details ? ` · ${r.details}` : ""}`)],
    ["5. 연락·보고", document.contacts.map((c) => `${c.name} (${c.role})${c.contact ? ` — ${c.contact}` : ""}`)],
    ["6. 예외 상황·꿀팁", document.exceptions.map((x) => `${x.situation} → ${x.tip}`)],
    ["7. 주의사항", document.cautions.map((c) => c.content)],
    ["8. 미해결·인계 항목", document.openItems.map((i) => i.content)],
  ];

  for (const [heading, items] of sections) {
    children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }));
    for (const text of items) {
      children.push(new Paragraph({ children: [new TextRun({ text: `• ${text}` })] }));
    }
    if (items.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "내용 없음", italics: true })] }));
    }
  }

  const docx = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(docx);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="handover-${id.slice(0, 8)}.docx"`,
    },
  });
}
