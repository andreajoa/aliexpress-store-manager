/**
 * connectorCapabilities mistura o que a análise da loja descobre (manifesto, categorias) com dados que o
 * próprio Manager mantém: vínculos AMB de fulfillment, a última varredura do catálogo e a linhagem dos exports.
 * Uma nova análise nunca pode apagar estes últimos — em 06/10/2026 uma análise em modo "fallback" gravou {} e
 * removeu todos os vínculos AMB, bloqueando o envio de qualquer pedido ao fornecedor.
 */
export const MANAGER_OWNED_CAPABILITY_KEYS = ["ambBridge", "ambCatalogScan", "ambExportLineage"] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function mergeScannedCapabilities(existing: unknown, scanned: unknown): Record<string, unknown> {
  const current = record(existing);
  const next: Record<string, unknown> = { ...record(scanned) };
  for (const key of MANAGER_OWNED_CAPABILITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
  }
  return next;
}
