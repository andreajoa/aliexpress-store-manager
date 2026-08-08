import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ConnectorResponse = {
  ok?: boolean;
  connector?: string;
  connectorVersion?: string;
  protocolVersion?: string;
  platform?: {
    framework?: string;
    deployment?: string;
  };
  capabilities?: unknown;
};

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;

  const store = await prisma.store.findUnique({
    where: {
      id,
    },
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

  const endpoint =
    store.apiEndpoint ||
    `${store.baseUrl.replace(/\/+$/, "")}/api/store-connector`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "AliExpress-Store-Manager/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(
        `O conector respondeu com HTTP ${response.status}.`
      );
    }

    const connector = (await response.json()) as ConnectorResponse;

    if (
      connector.ok !== true ||
      connector.connector !== "open-store-connector"
    ) {
      throw new Error(
        "O endereço respondeu, mas não é um Store Connector compatível."
      );
    }

    const updatedStore = await prisma.store.update({
      where: {
        id: store.id,
      },
      data: {
        status: "ACTIVE",
      },
    });

    return NextResponse.json({
      ok: true,
      store: updatedStore,
      connector: {
        name: connector.connector,
        version: connector.connectorVersion || null,
        protocolVersion: connector.protocolVersion || null,
        platform: connector.platform || null,
        capabilities: connector.capabilities || null,
      },
    });
  } catch (error) {
    await prisma.store.update({
      where: {
        id: store.id,
      },
      data: {
        status: "DISCONNECTED",
      },
    });

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível validar o conector.",
        endpoint,
      },
      { status: 502 }
    );
  }
}
