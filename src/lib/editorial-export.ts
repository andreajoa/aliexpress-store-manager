import fs from "node:fs/promises";
import path from "node:path";

import {
  prisma,
} from "@/lib/prisma";

import {
  readEditorialImage,
} from "@/lib/editorial-storage";


function auditPassed(
  value: unknown
) {
  return Boolean(
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    ) &&
    (
      value as Record<
        string,
        unknown
      >
    ).pass === true
  );
}


function baseName(
  assetType: string
) {
  const fixed:
    Record<
      string,
      string
    > = {
      AI_LIFESTYLE:
        "lifestyle",

      AI_IN_USE:
        "produto-em-uso",

      AI_PREMIUM_SCENE:
        "cena-premium",

      AI_DETAIL_CONTEXT:
        "detalhe-contextual",
    };

  return (
    fixed[
      assetType
    ] ||
    assetType
      .toLowerCase()
      .replace(
        /^ai_/,
        ""
      )
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      ) ||
    "editorial"
  );
}


export async function exportSelectedEditorialImages({
  productId,
  storeId,
  targetFolder,
}: {
  productId:
    string;

  storeId:
    string;

  targetFolder:
    string;
}) {
  const selected =
    await prisma
      .editorialAsset
      .findMany({
        where: {
          productId,
          storeId,
          selected:
            true,
        },

        orderBy: [
          {
            batch:
              "desc",
          },

          {
            createdAt:
              "asc",
          },
        ],
      });

  const approved =
    selected.filter(
      asset =>
        Boolean(
          asset.generatedPath
        ) &&
        auditPassed(
          asset.audit
        )
    );

  /*
   * A pasta editorial representa exatamente
   * a seleção atual. Portanto apagamos cópias
   * antigas antes de recriá-la.
   */
  await fs.rm(
    targetFolder,
    {
      recursive:
        true,
      force:
        true,
    }
  );

  await fs.mkdir(
    targetFolder,
    {
      recursive:
        true,
    }
  );

  const exported:
    Array<{
      id:
        string;

      type:
        string;

      batch:
        number;

      file:
        string;

      fidelityScore:
        number | null;
    }> =
    [];

  const errors:
    string[] =
    [];

  const counters =
    new Map<
      string,
      number
    >();

  for (
    const asset of
      approved
  ) {
    if (
      !asset.generatedPath
    ) {
      continue;
    }

    const base =
      baseName(
        asset.assetType
      );

    const count =
      (
        counters.get(
          base
        ) ||
        0
      ) + 1;

    counters.set(
      base,
      count
    );

    const filename =
      count === 1
        ? `${base}.png`
        : `${base}-${count}.png`;

    try {
      const buffer =
        await readEditorialImage(
          asset.generatedPath
        );

      await fs.writeFile(
        path.join(
          targetFolder,
          filename
        ),
        buffer
      );

      exported.push({
        id:
          asset.id,

        type:
          asset.assetType,

        batch:
          asset.batch,

        file:
          filename,

        fidelityScore:
          asset.fidelityScore,
      });
    } catch (error) {
      errors.push(
        `${asset.assetType}: ${
          error instanceof
            Error
            ? error.message
            : "erro"
        }`
      );
    }
  }

  const blockedOrInvalid =
    selected.length -
    approved.length;

  /*
   * Manifest da pasta editorial.
   * Ajuda tanto o usuário quanto
   * o futuro Publication Engine.
   */
  await fs.writeFile(
    path.join(
      targetFolder,
      "editoriais.json"
    ),

    JSON.stringify(
      {
        exportedAt:
          new Date()
            .toISOString(),

        productId,
        storeId,

        selected:
          selected.length,

        approved:
          approved.length,

        blockedOrInvalid,

        exported:
          exported.length,

        files:
          exported,

        errors,
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    selected:
      selected.length,

    approved:
      approved.length,

    blockedOrInvalid,

    exported,

    errors,
  };
}
