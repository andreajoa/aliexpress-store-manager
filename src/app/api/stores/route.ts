import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const storeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  baseUrl: z.string().trim().url(),
  githubOwner: z.string().trim().max(100).optional().or(z.literal("")),
  githubRepo: z.string().trim().max(150).optional().or(z.literal("")),
  githubBranch: z.string().trim().max(100).optional().or(z.literal("")),
});

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET() {
  const stores = await prisma.store.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json({
    ok: true,
    stores,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = storeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Verifique os dados informados.",
          fields: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const {
      name,
      baseUrl: rawBaseUrl,
      githubOwner,
      githubRepo,
      githubBranch,
    } = parsed.data;

    const baseUrl = normalizeUrl(rawBaseUrl);

    const protocol = new URL(baseUrl).protocol;

    if (protocol !== "http:" && protocol !== "https:") {
      return NextResponse.json(
        {
          ok: false,
          error: "A URL da loja precisa usar http ou https.",
        },
        { status: 400 }
      );
    }

    const existingStore = await prisma.store.findFirst({
      where: {
        baseUrl,
      },
    });

    if (existingStore) {
      return NextResponse.json(
        {
          ok: false,
          error: "Esta loja já está cadastrada.",
          store: existingStore,
        },
        { status: 409 }
      );
    }

    const slug = `${slugify(name)}-${randomUUID().slice(0, 8)}`;

    const store = await prisma.store.create({
      data: {
        name,
        slug,
        baseUrl,

        apiEndpoint: `${baseUrl}/api/store-connector`,

        connectionType:
          githubOwner && githubRepo
            ? "GITHUB_VERCEL"
            : "GENERIC_API",

        githubOwner: githubOwner || null,
        githubRepo: githubRepo || null,
        githubBranch:
          githubOwner && githubRepo
            ? githubBranch || "main"
            : null,

        status: "DISCONNECTED",
      },
    });

    return NextResponse.json(
      {
        ok: true,
        store,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro ao cadastrar loja:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Não foi possível cadastrar a loja.",
      },
      { status: 500 }
    );
  }
}
