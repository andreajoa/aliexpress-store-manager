import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      code: "LEGACY_IMPORT_DISABLED",
      error:
        "Esta rota antiga de importação foi desativada para evitar custo incorreto. Atualize a página e importe novamente; o fluxo atual calcula preço do item + frete oficial antes de liberar a precificação.",
    },
    { status: 410 },
  );
}
