import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RemoteCatalog = {
  ok?: boolean;
  connector?: string;
  protocolVersion?: string;
  catalog?: {
    currency?: string;
    priceUnit?: string;
    count?: number;
    products?: unknown[];
  };
};

function hasCapability(
  value: unknown,
  capability: string
): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  return (
    (value as Record<string, unknown>)[capability] === true
  );
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;

  const store = await prisma.store.findUnique({
    where: { id },
  });

  if (!store) {
    return NextResponse.json(
      {
        ok: false,
        error: "Loja não encontrada.",
      },
      { status: 404 }
    );
  }

  if (store.status !== "ACTIVE") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Valide o Store Connector antes de ler o catálogo.",
      },
      { status: 409 }
    );
  }

  const connectorBase = (
    store.apiEndpoint ||
    `${store.baseUrl.replace(/\/+$/, "")}/api/store-connector`
  ).replace(/\/+$/, "");

  const endpoint = `${connectorBase}/catalog`;

  const githubManagedCatalog = hasCapability(
    store.connectorCapabilities,
    "githubManagedCatalog"
  );

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "AliExpress-Store-Manager/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    /*
     * Um Store Connector pode declarar catálogo gerenciado
     * pelo GitHub sem necessariamente publicar um endpoint
     * HTTP /catalog.
     *
     * Isso NÃO significa que a loja está desconectada.
     */
    if (
      response.status === 404 ||
      response.status === 405
    ) {
      return NextResponse.json({
        ok: true,
        available: false,

        source: githubManagedCatalog
          ? "github-managed"
          : "connector-not-exposed",

        store: {
          id: store.id,
          name: store.name,
          baseUrl: store.baseUrl,
        },

        catalog: {
          currency: store.currency || "BRL",
          priceUnit: null,
          count: 0,
          products: [],
        },

        endpoint,

        warning: githubManagedCatalog
          ? "A loja utiliza catálogo gerenciado pelo GitHub e não expõe leitura de catálogo por este endpoint HTTP."
          : "O Store Connector não expõe um endpoint HTTP de catálogo.",

        publicationCompatible:
          githubManagedCatalog,
      });
    }

    if (!response.ok) {
      throw new Error(
        `Endpoint de catálogo respondeu com HTTP ${response.status}.`
      );
    }

    const data =
      (await response.json()) as RemoteCatalog;

    if (
      data.ok !== true ||
      data.connector !== "open-store-connector" ||
      !data.catalog ||
      !Array.isArray(data.catalog.products)
    ) {
      throw new Error(
        "A resposta recebida não corresponde ao protocolo de catálogo esperado."
      );
    }

    return NextResponse.json({
      ok: true,
      available: true,
      source: "connector",

      store: {
        id: store.id,
        name: store.name,
        baseUrl: store.baseUrl,
      },

      catalog: {
        currency:
          data.catalog.currency ||
          store.currency ||
          "BRL",

        priceUnit:
          data.catalog.priceUnit || null,

        count:
          data.catalog.products.length,

        products:
          data.catalog.products,
      },

      endpoint,

      publicationCompatible: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Não foi possível ler o catálogo.",

        endpoint,
      },
      { status: 502 }
    );
  }
}
