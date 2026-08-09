import type { Prisma } from "@/generated/prisma/client";

import {
  buildAmbExportLineageEntry,
  parseAmbExportLineage,
  type AmbExportLineageEntry,
  type AmbExportVariantInput,
} from "./amb-export-lineage-core";
import { prisma } from "./prisma";

export {
  buildAmbExportLineageEntry,
  type AmbExportLineageEntry,
  type AmbExportVariantInput,
} from "./amb-export-lineage-core";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function recordAmbProductExport(input: {
  storeId: string;
  productId: string;
  sourceProductId: string;
  sourceUrl: string;
  variants: AmbExportVariantInput[];
}) {
  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { connectorCapabilities: true },
  });
  if (!store) throw new Error("Loja não encontrada para registrar exportação.");

  const capabilities = record(store.connectorCapabilities);
  const lineage = record(capabilities.ambExportLineage);
  const previous = Array.isArray(lineage.exports) ? lineage.exports : [];
  const entry = buildAmbExportLineageEntry(input);
  const exports = [
    ...previous.filter((raw) => record(raw).productId !== input.productId),
    entry,
  ].slice(-250);

  const next = {
    ...capabilities,
    ambExportLineage: {
      version: 1,
      updatedAt: new Date().toISOString(),
      exports,
    },
  };

  await prisma.store.update({
    where: { id: input.storeId },
    data: { connectorCapabilities: next as Prisma.InputJsonValue },
  });

  return entry;
}

export function ambExportLineageFromCapabilities(value: unknown): AmbExportLineageEntry[] {
  return parseAmbExportLineage(value);
}
