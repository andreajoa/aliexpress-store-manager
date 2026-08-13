import Link from "next/link";

import { aliExpressConnectionStatus, aliExpressConfig } from "@/lib/aliexpress-connection";
import { DisconnectAliExpressButton } from "./disconnect-button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AliExpressSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  let configured = true;
  try {
    aliExpressConfig();
  } catch {
    configured = false;
  }
  const status = await aliExpressConnectionStatus();

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">← Dashboard</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">Integrações</p>
        <h1 className="mt-2 text-3xl font-semibold">AliExpress Open Platform</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
          Autorize a conta compradora para consultar SKU oficial, calcular frete, criar pedidos não pagos e sincronizar rastreamento. O access token é criptografado antes de ser armazenado.
        </p>

        {params.connected === "1" && (
          <div className="mt-6 rounded-xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-200">
            Conta AliExpress autorizada com sucesso.
          </div>
        )}
        {params.error && (
          <div className="mt-6 rounded-xl border border-red-900 bg-red-950/30 p-4 text-sm text-red-200">
            A autorização não foi concluída ({params.error}). Tente novamente.
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Conexão</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Configuração do app: {configured ? "pronta" : "faltando variáveis no ambiente"}.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.connected ? "bg-emerald-950 text-emerald-300" : status.expired ? "bg-amber-950 text-amber-300" : "bg-zinc-800 text-zinc-300"}`}>
              {status.connected ? "Conectado" : status.expired ? "Expirado" : "Não conectado"}
            </span>
          </div>

          {status.connection && (
            <dl className="mt-6 grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-zinc-500">Conta</dt><dd className="mt-1">{status.connection.userNick || "—"}</dd></div>
              <div><dt className="text-zinc-500">User ID</dt><dd className="mt-1">{status.connection.userId || "—"}</dd></div>
              <div><dt className="text-zinc-500">Autorizada em</dt><dd className="mt-1">{status.connection.authorizedAt.toLocaleString("pt-BR")}</dd></div>
              <div><dt className="text-zinc-500">Expira em</dt><dd className="mt-1">{status.connection.expiresAt.toLocaleString("pt-BR")}</dd></div>
            </dl>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {configured && (
              <a
                href="/api/aliexpress/oauth/start"
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950"
              >
                {status.connection ? "Autorizar novamente" : "Conectar AliExpress"}
              </a>
            )}
            {status.connection && <DisconnectAliExpressButton />}
          </div>

          {status.needsReauthorization && !status.expired && (
            <p className="mt-4 text-sm text-amber-300">
              A autorização está próxima de expirar. Renove antes de criar novos pedidos.
            </p>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold">Pagamento</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            O Manager cria o pedido AliExpress com produto, variante, quantidade e endereço corretos. O pagamento continua sendo confirmado no ambiente autorizado do AliExpress; o Manager não armazena cartão.
          </p>
        </section>
      </div>
    </main>
  );
}
