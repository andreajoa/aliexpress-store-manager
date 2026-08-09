import { prisma } from "./prisma";
import { readEditorialImage } from "./editorial-storage";
import {
  benefitText,
  csvFromExportRows,
  fetchExportImage,
  jsonObject,
  safeExportName,
} from "./web-export-utils";
import type { ZipEntry } from "./zip-archive";

type ExportStore = {
  id: string;
  name: string;
  baseUrl: string;
};

type ExportPublication = {
  status: string;
  targetCategory: string | null;
  targetAgeRange: string | null;
  externalUrl: string | null;
};

type ExportImage = {
  sourceUrl: string;
  storedUrl: string | null;
};

type ExportVariant = {
  sourceSkuId: string;
  sku: string | null;
  attributes: unknown;
  costPrice: { toString(): string } | null;
  sourceCurrency: string | null;
  salePrice: { toString(): string } | null;
  stock: number | null;
  available: boolean;
  imageUrl: string | null;
};

type ExportProduct = {
  id: string;
  sourceProductId: string;
  sourceProvider: string;
  sourceUrl: string;
  sourceTitle: string;
  optimizedTitle: string | null;
  headline: string | null;
  shortDescription: string | null;
  benefits: unknown;
  cta: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  specifications: unknown;
  sourceCurrency: string | null;
  costMin: { toString(): string } | null;
  costMax: { toString(): string } | null;
  storeCurrency: string;
  recommendedPrice: { toString(): string } | null;
  compareAtPrice: { toString(): string } | null;
  status: string;
  images: ExportImage[];
  variants: ExportVariant[];
};

function auditPassed(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).pass === true
  );
}

function editorialBaseName(assetType: string) {
  const fixed: Record<string, string> = {
    AI_LIFESTYLE: "lifestyle",
    AI_IN_USE: "produto-em-uso",
    AI_PREMIUM_SCENE: "cena-premium",
    AI_DETAIL_CONTEXT: "detalhe-contextual",
  };

  return (
    fixed[assetType] ||
    assetType
      .toLowerCase()
      .replace(/^ai_/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    "editorial"
  );
}

export async function buildProductWebExport({
  product,
  store,
  publication,
  prefix,
}: {
  product: ExportProduct;
  store: ExportStore;
  publication: ExportPublication | null;
  prefix?: string;
}) {
  const root =
    prefix ||
    `${safeExportName(store.name)}/produtos/${safeExportName(
      product.optimizedTitle || product.sourceTitle
    )}`;
  const entries: ZipEntry[] = [];
  const specs = jsonObject(product.specifications);
  const packageData = jsonObject(specs.package);

  const summary: Record<string, unknown> = {
    loja: store.name,
    manager_product_id: product.id,
    aliexpress_id: product.sourceProductId,
    origem: product.sourceProvider,
    url_origem: product.sourceUrl,
    titulo_original: product.sourceTitle,
    titulo: product.optimizedTitle,
    headline: product.headline,
    descricao: product.shortDescription,
    beneficios: benefitText(product.benefits),
    cta: product.cta,
    seo_title: product.seoTitle,
    seo_description: product.seoDescription,
    categoria: publication?.targetCategory || "",
    faixa_etaria: publication?.targetAgeRange || "",
    moeda_venda: product.storeCurrency,
    preco_inicial: product.recommendedPrice?.toString() || "",
    preco_comparativo: product.compareAtPrice?.toString() || "",
    moeda_custo: product.sourceCurrency,
    custo_minimo: product.costMin?.toString() || "",
    custo_maximo: product.costMax?.toString() || "",
    peso_kg: packageData.weight_kg || "",
    comprimento_cm: packageData.length_cm || "",
    largura_cm: packageData.width_cm || "",
    altura_cm: packageData.height_cm || "",
    status_produto: product.status,
    status_publicacao: publication?.status || "",
    url_produto: publication?.externalUrl || "",
    exportado_em: new Date().toISOString(),
  };

  const variants = product.variants.map(
    (variant) => ({
      aliexpress_id: product.sourceProductId,
      source_sku_id: variant.sourceSkuId,
      sku: variant.sku,
      variante: Object.entries(
        jsonObject(variant.attributes)
      )
        .map(
          ([key, value]) =>
            `${key}: ${String(value)}`
        )
        .join(" | "),
      custo: variant.costPrice?.toString() || "",
      moeda_custo: variant.sourceCurrency,
      preco_venda: variant.salePrice?.toString() || "",
      moeda_venda: product.storeCurrency,
      estoque: variant.stock,
      disponivel: variant.available,
      imagem: variant.imageUrl || "",
    })
  );

  entries.push({
    name: `${root}/produto.csv`,
    data: csvFromExportRows([summary]),
  });
  entries.push({
    name: `${root}/variantes.csv`,
    data: csvFromExportRows(variants),
  });
  entries.push({
    name: `${root}/produto.json`,
    data: JSON.stringify(
      {
        store: {
          id: store.id,
          name: store.name,
          url: store.baseUrl,
        },
        product: summary,
        variants,
        specifications: product.specifications,
        publication: publication
          ? {
              status: publication.status,
              category: publication.targetCategory,
              ageRange: publication.targetAgeRange,
              url: publication.externalUrl,
            }
          : null,
      },
      null,
      2
    ),
  });

  const imageErrors: string[] = [];

  for (
    let index = 0;
    index < product.images.length;
    index += 1
  ) {
    const image = product.images[index];
    const url = image.storedUrl || image.sourceUrl;

    try {
      const downloaded = await fetchExportImage({ url });
      entries.push({
        name:
          `${root}/imagens/originais/${String(
            index + 1
          ).padStart(2, "0")}${downloaded.extension}`,
        data: downloaded.bytes,
      });
    } catch (error) {
      imageErrors.push(
        `${index + 1}: ${
          error instanceof Error
            ? error.message
            : "erro"
        }`
      );
    }
  }

  const selectedEditorials =
    await prisma.editorialAsset.findMany({
      where: {
        productId: product.id,
        storeId: store.id,
        selected: true,
      },
      orderBy: [
        { batch: "desc" },
        { createdAt: "asc" },
      ],
    });
  const approvedEditorials =
    selectedEditorials.filter(
      (asset) =>
        Boolean(asset.generatedPath) &&
        auditPassed(asset.audit)
    );
  const editorialErrors: string[] = [];
  const editorialFiles: Array<{
    id: string;
    type: string;
    batch: number;
    file: string;
    fidelityScore: number | null;
  }> = [];
  const counters = new Map<string, number>();

  for (const asset of approvedEditorials) {
    if (!asset.generatedPath) continue;

    const base = editorialBaseName(asset.assetType);
    const count = (counters.get(base) || 0) + 1;
    counters.set(base, count);
    const filename =
      count === 1
        ? `${base}.png`
        : `${base}-${count}.png`;

    try {
      const bytes = await readEditorialImage(
        asset.generatedPath
      );
      entries.push({
        name: `${root}/imagens/editoriais/${filename}`,
        data: bytes,
      });
      editorialFiles.push({
        id: asset.id,
        type: asset.assetType,
        batch: asset.batch,
        file: filename,
        fidelityScore: asset.fidelityScore,
      });
    } catch (error) {
      editorialErrors.push(
        `${asset.assetType}: ${
          error instanceof Error
            ? error.message
            : "erro"
        }`
      );
    }
  }

  const editorialReport = {
    exportedAt: new Date().toISOString(),
    productId: product.id,
    storeId: store.id,
    selected: selectedEditorials.length,
    approved: approvedEditorials.length,
    blockedOrInvalid:
      selectedEditorials.length -
      approvedEditorials.length,
    exported: editorialFiles.length,
    files: editorialFiles,
    errors: editorialErrors,
  };

  entries.push({
    name: `${root}/imagens/editoriais/editoriais.json`,
    data: JSON.stringify(editorialReport, null, 2),
  });
  entries.push({
    name: `${root}/export-report.json`,
    data: JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        originalImages: product.images.length,
        editorialExport: editorialReport,
        imageErrors,
      },
      null,
      2
    ),
  });

  return {
    entries,
    summary,
    variants,
    errors: [
      ...imageErrors,
      ...editorialErrors,
    ],
  };
}
