import { NextResponse } from "next/server";

import { readEditorialBinary } from "@/lib/editorial-binary-store";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const asset = await prisma.editorialAsset.findUnique({
    where: { id },
    select: {
      id: true,
      generatedPath: true,
      generationProvider: true,
    },
  });

  if (!asset || !asset.generatedPath || !asset.generationProvider) {
    return NextResponse.json(
      { ok: false, error: "Editorial gerado não encontrado." },
      { status: 404 },
    );
  }

  try {
    const binary = await readEditorialBinary(asset.generatedPath);
    if (!binary) {
      return NextResponse.json(
        {
          ok: false,
          error: "Conteúdo editorial não está persistido. Regenere esta imagem no ambiente online.",
        },
        { status: 404 },
      );
    }

    return new NextResponse(binary.bytes, {
      status: 200,
      headers: {
        "Content-Type": binary.mimeType,
        "Content-Length": String(binary.byteSize),
        ETag: `"${binary.sha256}"`,
        "Cache-Control": "private, no-store",
        "X-Editorial-Storage": binary.source,
      },
    });
  } catch (error) {
    console.error("Editorial content read failed:", error);
    return NextResponse.json(
      { ok: false, error: "Falha de integridade ao carregar o editorial." },
      { status: 500 },
    );
  }
}
