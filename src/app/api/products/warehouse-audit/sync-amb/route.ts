import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Triggers AMB Boutique to pull the latest sanitized delivery windows from Store Manager.
 * Protected by Store Manager admin proxy; AMB verifies its own signed Ed25519 call back here.
 */
export async function POST() {
  const ambBase = (
    process.env.AMB_BOUTIQUE_BASE_URL?.trim() ||
    "https://www.ambboutique.online"
  ).replace(/\/+$/, "");

  try {
    const response = await fetch(`${ambBase}/api/delivery-windows`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      syncedProducts?: number;
      syncedRows?: number;
      throttled?: boolean;
      reason?: string;
      error?: string;
      timestamp?: string;
    } | null;

    if (!response.ok || !data?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data?.error || data?.reason || `AMB Boutique retornou HTTP ${response.status}.`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      syncedProducts: data.syncedProducts ?? 0,
      syncedRows: data.syncedRows ?? 0,
      throttled: Boolean(data.throttled),
      timestamp: data.timestamp || new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Não foi possível sincronizar com a AMB Boutique.",
      },
      { status: 502 },
    );
  }
}
