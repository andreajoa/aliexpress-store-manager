/*
 * O aliexpress.us mantém um catálogo paralelo ao global: o mesmo produto recebe
 * um ID diferente em cada um. Os dois diferem por exatamente 2^51 — verificado
 * com o par 3256807571372169 (.us) e 1005007757686921 (.com), que apontam para o
 * mesmo produto. Nenhum ID do catálogo global alcança 2^51, então a conversão só
 * dispara em IDs regionais e nunca altera um ID que já é global.
 *
 * Módulo sem dependências de propósito: precisa ser testável sem banco nem rede.
 */
const US_CATALOG_ID_OFFSET = BigInt("2251799813685248"); // 2^51

export function globalAliExpressProductId(productId: string): string | null {
  if (!/^\d{10,}$/.test(productId)) return null;

  const numeric = BigInt(productId);
  if (numeric < US_CATALOG_ID_OFFSET) return null;

  const converted = (numeric - US_CATALOG_ID_OFFSET).toString();
  return /^\d{10,}$/.test(converted) ? converted : null;
}
