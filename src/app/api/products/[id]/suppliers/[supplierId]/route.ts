import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const patchSchema = z.object({
  role: z.enum(["PRIMARY", "BACKUP", "ALTERNATIVE"]).optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Nenhuma alteração informada.",
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; supplierId: string }> },
) {
  try {
    const { id, supplierId } = await context.params;
    const parsed = patchSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message || "Alteração inválida." },
        { status: 400 },
      );
    }

    const current = await prisma.supplierProduct.findFirst({
      where: { id: supplierId, productId: id },
    });

    if (!current) {
      return NextResponse.json({ ok: false, error: "Fornecedor não encontrado." }, { status: 404 });
    }

    if (current.role === "PRIMARY" && parsed.data.status === "DISABLED") {
      return NextResponse.json(
        { ok: false, error: "Promova outro fornecedor antes de desativar o fornecedor principal." },
        { status: 409 },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (parsed.data.role === "PRIMARY") {
        await tx.supplierProduct.updateMany({
          where: {
            productId: id,
            id: { not: supplierId },
            role: "PRIMARY",
            status: "ACTIVE",
          },
          data: { role: "BACKUP", priority: 50 },
        });
      }

      return tx.supplierProduct.update({
        where: { id: supplierId },
        data: {
          role: parsed.data.role,
          priority:
            parsed.data.priority ??
            (parsed.data.role === "PRIMARY"
              ? 0
              : parsed.data.role === "BACKUP"
                ? 50
                : undefined),
          status: parsed.data.status,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      supplier: {
        id: updated.id,
        role: updated.role,
        priority: updated.priority,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error("Supplier update failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Não foi possível atualizar o fornecedor." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; supplierId: string }> },
) {
  try {
    const { id, supplierId } = await context.params;
    const current = await prisma.supplierProduct.findFirst({
      where: { id: supplierId, productId: id },
    });

    if (!current) {
      return NextResponse.json({ ok: false, error: "Fornecedor não encontrado." }, { status: 404 });
    }

    if (current.role === "PRIMARY" && current.status === "ACTIVE") {
      return NextResponse.json(
        { ok: false, error: "O fornecedor principal não pode ser removido antes da promoção de outro fornecedor." },
        { status: 409 },
      );
    }

    await prisma.$transaction([
      prisma.supplierVariantMapping.updateMany({
        where: { supplierProductId: supplierId },
        data: { active: false },
      }),
      prisma.supplierProduct.update({
        where: { id: supplierId },
        data: { status: "DISABLED" },
      }),
    ]);

    return NextResponse.json({ ok: true, disabled: true });
  } catch (error) {
    console.error("Supplier disable failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Não foi possível desativar o fornecedor." },
      { status: 500 },
    );
  }
}
