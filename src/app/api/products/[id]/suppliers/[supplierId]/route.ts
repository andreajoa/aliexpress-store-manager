import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { extractSupplierDeliveryProfile } from "@/lib/supplier-delivery";

export const runtime = "nodejs";

const manualDeliverySchema = z.object({
  minDays: z.number().int().min(1).max(60),
  maxDays: z.number().int().min(1).max(60),
  allMarkets: z.boolean().optional(),
}).refine((value) => value.maxDays >= value.minDays, {
  message: "O prazo máximo deve ser maior ou igual ao prazo mínimo.",
});

const patchSchema = z.object({
  role: z.enum(["PRIMARY", "BACKUP", "ALTERNATIVE"]).optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
  manualDeliveryDays: manualDeliverySchema.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Nenhuma alteração informada.",
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

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

      let nextRawPayload: Prisma.InputJsonValue | undefined;
      if (parsed.data.manualDeliveryDays !== undefined) {
        const currentRaw = { ...asRecord(current.rawPayload) };
        if (parsed.data.manualDeliveryDays === null) {
          delete currentRaw.manualDeliveryDays;
        } else {
          currentRaw.manualDeliveryDays = {
            minDays: parsed.data.manualDeliveryDays.minDays,
            maxDays: parsed.data.manualDeliveryDays.maxDays,
            allMarkets: parsed.data.manualDeliveryDays.allMarkets === true,
            updatedAt: new Date().toISOString(),
          };
        }
        nextRawPayload = JSON.parse(JSON.stringify(currentRaw)) as Prisma.InputJsonValue;
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
          ...(nextRawPayload !== undefined ? { rawPayload: nextRawPayload } : {}),
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
        delivery: extractSupplierDeliveryProfile({
          supplierRawPayload: updated.rawPayload,
          supplierUpdatedAt: updated.lastCheckedAt,
        }),
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
