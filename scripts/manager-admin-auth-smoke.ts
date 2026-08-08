import {
  isPublicManagerPath,
  managerAdminCredentialsFromEnv,
  parseBasicAuthorization,
  verifyManagerAdminAuthorization,
} from "../src/lib/manager-admin-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== ENV ===");
assert(managerAdminCredentialsFromEnv({}) === null, "Credenciais ausentes não podem gerar defaults");
const credentials = managerAdminCredentialsFromEnv({
  MANAGER_ADMIN_USER: "admin",
  MANAGER_ADMIN_PASSWORD: "senha:forte",
});
assert(credentials?.username === "admin", "Usuário não carregado");
assert(credentials?.password === "senha:forte", "Senha não carregada");
console.log("✅ sem credencial default embutida");

console.log("=== BASIC ===");
const validHeader = `Basic ${btoa("admin:senha:forte")}`;
assert(parseBasicAuthorization(validHeader)?.password === "senha:forte", "Senha com dois-pontos foi truncada");
assert(credentials && verifyManagerAdminAuthorization(validHeader, credentials), "Credencial correta rejeitada");
assert(credentials && !verifyManagerAdminAuthorization(`Basic ${btoa("admin:errada")}`, credentials), "Senha errada aceita");
assert(credentials && !verifyManagerAdminAuthorization(null, credentials), "Ausência de auth aceita");
console.log("✅ autenticação Basic validada sem comparação antecipada");

console.log("=== PUBLIC PATHS ===");
assert(isPublicManagerPath("/api/health"), "Health precisa permanecer público");
assert(isPublicManagerPath("/api/stores/store-123/orders/webhook"), "Webhook por loja precisa passar para auth Bearer própria");
assert(isPublicManagerPath("/api/stores/store-123/inventory/reservations"), "Reserva de estoque precisa passar para auth Bearer própria da loja");
assert(isPublicManagerPath("/api/aliexpress/oauth/callback"), "Callback OAuth precisa chegar ao validador de state/cookie");
assert(isPublicManagerPath("/api/cron/maintenance"), "Cron precisa chegar ao validador Bearer CRON_SECRET");
assert(!isPublicManagerPath("/api/aliexpress/oauth/start"), "Início do OAuth deve exigir admin auth");
assert(!isPublicManagerPath("/api/aliexpress/connection"), "Estado da conta AliExpress deve exigir admin auth");
assert(!isPublicManagerPath("/api/stores/store-123/webhook-token"), "Rotação do token deve exigir admin auth");
assert(!isPublicManagerPath("/orders"), "Pedidos devem exigir admin auth");
assert(!isPublicManagerPath("/api/publications/abc/merge"), "Merge deve exigir admin auth");
console.log("✅ rotas públicas possuem autenticação/validação própria e rotas administrativas continuam protegidas");

console.log("====================================================");
console.log("MANAGER ADMIN AUTH: PASS");
console.log("====================================================");
