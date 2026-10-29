import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadTs(file, imports = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  new Function('require', 'module', 'exports', 'console', code)((name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (['zod', 'next/server'].includes(name)) return require(name);
    throw new Error(`Unmocked dependency blocked: ${name}`);
  }, loaded, loaded.exports, { ...console, info() {}, warn() {}, error() {} });
  return loaded.exports;
}
const options = loadTs('src/lib/supplier-refresh-options.ts');
const costingScope = loadTs('src/lib/supplier-costing-scope.ts', {'./supplier-refresh-options': options});
const costHelpers = loadTs('src/lib/aliexpress-import-costing.ts', {'./aliexpress-connection': {}, './aliexpress-landed-cost': {}, './fx-rate': {}});
const aliases = loadTs('src/lib/aliexpress-catalog-id.ts');
const catalog = loadTs('src/lib/supplier-catalog.ts');
const mapper = loadTs('src/lib/supplier-variant-mapper.ts');
const selection = loadTs('src/lib/supplier-selection.ts');
const pricing = loadTs('src/lib/product-pricing.ts');
const sourceId = '3256807571372169';
const globalId = '1005007757686921';
const routeFile = 'src/app/api/products/[id]/suppliers/[supplierId]/refresh/route.ts';

function harness({ allowWrites = false, actualCosting = false } = {}) {
  const calls = { reads: [], writes: [], provider: [], costing: [], sessions: [], freight: [], syncReads: [] };
  const canonical = [
    { id: 'canonical-a', sourceSkuId: 'sku-a', attributes: { Color: 'Red', Size: 'S' }, stock: 99, available: true },
    { id: 'canonical-b', sourceSkuId: 'sku-b', attributes: { Color: 'Blue', Size: 'M' }, stock: 99, available: true },
  ];
  const supplier = {
    id: 'supplier-1', productId: 'product-1', sourceProductId: sourceId, provider: 'ALIEXPRESS', role: 'PRIMARY', status: 'ACTIVE',
    priority: 0, sourceCurrency: 'USD', lastCheckedAt: new Date(),
    variants: canonical.map((v, i) => ({ id: `supplier-${i}`, sourceSkuId: v.sourceSkuId, attributes: v.attributes, stock: 99, sourcePrice: 1 })),
    mappings: canonical.map((v, i) => ({ id: `mapping-${i}`, canonicalVariantId: v.id, supplierVariantId: `supplier-${i}`, active: true })),
  };
  const operational = {
    provider: 'ALIEXPRESS_OPEN_PLATFORM', requestedProductId: sourceId, resolvedProductId: globalId, warnings: [],
    product: {
      id: globalId, title: 'Fixture dress', currency: 'USD',
      variants: [
        { attribute_name: 'Color', options: [{ value_id: 'red', name: 'Red' }, { value_id: 'blue', name: 'Blue' }] },
        { attribute_name: 'Size', options: [{ value_id: 's', name: 'S' }, { value_id: 'm', name: 'M' }] },
      ],
      sku_pricing: [
        { sku_id: 'sku-a', sale_price: 10, available_quantity: 3, variant_ids: 'red,s', currency_code: 'USD' },
        { sku_id: 'sku-b', sale_price: 20, available_quantity: 0, variant_ids: 'blue,m', currency_code: 'USD' },
      ],
    },
  };
  const state = { product: { id: 'product-1', variants: canonical }, supplier, operational, costFailure: null, providerFailure: false };
  const write = (name, fn) => async (...args) => {
    calls.writes.push(name);
    if (!allowWrites) throw new Error(`WRITE FORBIDDEN IN DRY RUN: ${name}`);
    return fn(...args);
  };
  const delegates = {
    product: { findUnique: async (args) => {
      calls.reads.push('product.findUnique');
      if (args.include.supplierProducts) {
        calls.syncReads.push('product');
        return { id: 'product-1', variants: canonical, supplierProducts: [{ ...supplier, mappings: supplier.mappings.map((m) => ({ ...m, supplierVariant: supplier.variants.find((v) => v.id === m.supplierVariantId) })) }] };
      }
      return state.product;
    } },
    supplierProduct: {
      findFirst: async () => { calls.reads.push('supplierProduct.findFirst'); return state.supplier; },
      update: write('supplierProduct.update', async ({ data }) => Object.assign(supplier, data)),
      findUniqueOrThrow: async () => supplier,
    },
    supplierVariant: {
      update: write('supplierVariant.update', async ({ where, data }) => Object.assign(supplier.variants.find((v) => v.id === where.id), data)),
      create: write('supplierVariant.create', async ({ data }) => { const v = { ...data, id: 'new-supplier-variant' }; supplier.variants.push(v); return v; }),
      updateMany: write('supplierVariant.updateMany', async () => ({ count: 0 })),
    },
    supplierVariantMapping: {
      createMany: write('supplierVariantMapping.createMany', async () => ({ count: 0 })),
      updateMany: write('supplierVariantMapping.updateMany', async () => ({ count: 0 })),
    },
    productVariant: { update: write('productVariant.update', async (args) => args) },
    orderItem: { findMany: async () => { calls.syncReads.push('orders'); return []; } },
    inventoryReservationItem: { findMany: async () => { calls.syncReads.push('reservations'); return []; } },
  };
  // Deny every unlisted Prisma operation, including nested reads/writes added in
  // future. In dryRun even entering $transaction is an immediate test failure.
  const strict = (target, prefix = 'prisma') => new Proxy(target, {
    get(object, name) {
      if (!Object.hasOwn(object, name)) throw new Error(`Unmocked Prisma operation: ${prefix}.${String(name)}`);
      const value = object[name];
      return typeof value === 'object' ? strict(value, `${prefix}.${name}`) : value;
    },
  });
  const prisma = strict({ ...delegates, $transaction: write('$transaction', async (operation) => typeof operation === 'function' ? operation(strict(delegates, 'tx')) : Promise.all(operation)) });
  let costing;
  if (actualCosting) {
    const landed = loadTs('src/lib/aliexpress-landed-cost.ts');
    costing = loadTs('src/lib/aliexpress-import-costing.ts', {
      './aliexpress-connection': { requireAliExpressSession: async (opt) => {
        calls.sessions.push(opt);
        return { session: 'mock-session', client: { calculateFreight: async (input) => {
          calls.freight.push(input);
          if (input.skuId === 'sku-c') throw new Error('Zero-stock SKU cannot quote freight');
          return [{ serviceName: 'Mock official shipping', amount: 4, currency: 'USD', estimatedDeliveryTime: '7' }];
        } } };
      } },
      './aliexpress-landed-cost': landed,
      './fx-rate': { fetchFxRate: async () => { throw new Error('Unexpected FX request'); } },
    }).buildAliExpressImportCosting;
  } else {
    costing = async (input) => {
      const rows = input.skuPricing.map((sku) => ({ sku, itemPrice: sku.sale_price, itemCurrency: 'USD', itemCostInCostCurrency: sku.sale_price, freightCostInCostCurrency: 4, landedCost: sku.sale_price + 4, costCurrency: 'USD' }));
      const result = {
        complete: true, costedSkus: rows, costMin: Math.min(...rows.map((r) => r.landedCost)), costMax: Math.max(...rows.map((r) => r.landedCost)), costCurrency: 'USD', warning: null,
        snapshot: { status: 'COMPLETE', basis: 'ITEM_PLUS_FREIGHT', countryCode: 'US', calculatedAt: '2026-10-26T05:00:00.000Z', freight: { status: 'AVAILABLE' } },
      };
      if (state.costFailure === 'foreign') { result.costCurrency = 'EUR'; result.snapshot.countryCode = 'FR'; }
      if (state.costFailure === 'pending') { result.complete = false; result.warning = 'US freight unavailable'; }
      if (state.costFailure === 'missing') result.costedSkus.pop();
      if (state.costFailure === 'null-freight') result.costedSkus[0].freightCostInCostCurrency = null;
      if (state.costFailure === 'nan-cost') result.costedSkus[0].landedCost = NaN;
      if (state.costFailure === 'duplicate') result.costedSkus.push(result.costedSkus[0]);
      return result;
    };
  }
  const service = loadTs('src/lib/supplier-refresh-service.ts', {
    './prisma': { prisma }, './supplier-catalog': catalog, './supplier-variant-mapper': mapper, './supplier-selection': selection,
    './supplier-refresh-options': options, './supplier-costing-scope': costingScope, './aliexpress-catalog-id': aliases, './product-pricing': pricing,
    './aliexpress-operational-provider': { getAliExpressOperationalProduct: async (...args) => {
      calls.provider.push(args); if (state.providerFailure) throw new Error('Provider unavailable'); return operational;
    } },
    './aliexpress-import-costing': { unavailableScopedImportCosting: costHelpers.unavailableScopedImportCosting, aliExpressImportCostBreakdown: costHelpers.aliExpressImportCostBreakdown, buildAliExpressImportCosting: async (input) => { calls.costing.push(input); return costing(input); } },
  });
  const route = loadTs(routeFile, { '@/lib/supplier-refresh-service': service, '@/lib/supplier-refresh-options': options });
  return { state, calls, service, async post(body = '', raw = false) {
    const response = await route.POST(new Request('https://manager.test/api/products/product-1/suppliers/supplier-1/refresh', {
      method: 'POST', ...(body !== '' ? { body: raw ? body : JSON.stringify(body) } : {}),
    }), { params: Promise.resolve({ id: 'product-1', supplierId: 'supplier-1' }) });
    return { status: response.status, body: await response.json() };
  } };
}
globalThis.fetch = async () => { throw new Error('Real network forbidden in tests'); };

test('filtered dryRun executes actual handler + service; returns current costs/stocks and no Prisma writes', async () => {
  const h = harness(); const result = await h.post({ dryRun: true, sourceSkuIds: ['sku-a'] });
  assert.equal(result.status, 200); assert.equal(result.body.dryRun, true); assert.equal(result.body.persisted, false);
  assert.equal(result.body.variants, 1); assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.syncReads, []);
  assert.deepEqual(h.calls.provider[0], [sourceId, { readOnlySession: true, officialOnly: true }]);
  assert.deepEqual(h.calls.costing[0].skuPricing.map((s) => s.sku_id), ['sku-a']); assert.equal(h.calls.costing[0].readOnlySession, true);
  const q = result.body.quotedSkus[0];
  assert.equal(q.stock, 3); assert.deepEqual(q.attributes, { Color: 'Red', Size: 'S' });
  assert.equal(q.itemPrice, 10); assert.equal(q.freightCostInCostCurrency, 4); assert.equal(q.landedCost, 14);
  assert.equal(q.costCurrency, 'USD'); assert.equal(q.countryCode, 'US'); assert.equal(q.minimumRetail3x, 42); assert.equal(q.suggestedRetail3x90, 42.9);
  assert.equal(q.verifiedAt, '2026-10-26T05:00:00.000Z'); assert.equal(result.body.refreshedAt, q.verifiedAt);
  assert.equal(result.body.suggestedMapping.suggestions.length, 1);
});

test('unfiltered dryRun quotes all SKUs and preserves genuine zero stock', async () => {
  const h = harness(); const r = await h.post({ dryRun: true }); assert.equal(r.status, 200);
  assert.equal(r.body.quotedSkus.length, 2); assert.equal(r.body.quotedSkus[1].stock, 0); assert.equal(r.body.quotedSkus[1].available, false); assert.deepEqual(h.calls.writes, []);
});

test('actual costing helper requests official freight only for selected SKU, using read-only session', async () => {
  const h = harness({ actualCosting: true }); const r = await h.post({ dryRun: true, sourceSkuIds: ['sku-b'] });
  assert.equal(r.status, 200); assert.deepEqual(h.calls.freight.map((x) => x.skuId), ['sku-b']); assert.equal(h.calls.freight[0].productId, globalId);
  assert.deepEqual(h.calls.sessions, [{ readOnly: true }]); assert.equal(r.body.quotedSkus[0].landedCost, 24); assert.equal(r.body.costSnapshot.perSku.length, 1); assert.deepEqual(h.calls.writes, []);
});

for (const input of [{ sourceSkuIds: ['sku-a'] }, { dryRun: false, sourceSkuIds: ['sku-a'] }, { dryRun: 'true' }, { dryRun: true, sourceSkuIds: [] }, { dryRun: true, sourceSkuIds: [''] }, { dryRun: true, sourceSkuIds: [123] }, { dryRun: true, sourceSkuIds: ['sku-a', 'sku-a'] }]) {
  test(`invalid options fail before provider or writes: ${JSON.stringify(input)}`, async () => {
    const h = harness(); assert.equal((await h.post(input)).status, 400); assert.equal(h.calls.provider.length, 0); assert.deepEqual(h.calls.writes, []);
  });
}
test('malformed JSON does not accidentally invoke legacy refresh', async () => {
  const h = harness(); assert.equal((await h.post('{', true)).status, 400); assert.equal(h.calls.reads.length, 0);
});
test('service independently rejects sourceSkuIds without dryRun', async () => {
  const h = harness(); await assert.rejects(h.service.refreshSupplier({ productId: 'product-1', supplierId: 'supplier-1', sourceSkuIds: ['sku-a'] }), /dryRun/); assert.equal(h.calls.reads.length, 0);
});
test('unknown SKU is validated against current official source, never stale database', async () => {
  const h = harness(); const r = await h.post({ dryRun: true, sourceSkuIds: ['not-in-official'] }); assert.equal(r.status, 400); assert.equal(h.calls.costing.length, 0); assert.deepEqual(h.calls.writes, []);
});
test('filtered dryRun refuses a nonofficial fallback product', async () => {
  const h = harness(); h.state.operational.provider = 'OMKAR'; assert.equal((await h.post({ dryRun: true, sourceSkuIds: ['sku-a'] })).status, 422); assert.equal(h.calls.costing.length, 0); assert.deepEqual(h.calls.writes, []);
});
test('unknown stock is not converted into certified zero availability', async () => {
  const h = harness(); delete h.state.operational.product.sku_pricing[0].available_quantity;
  assert.equal((await h.post({ dryRun: true })).status, 422); assert.equal(h.calls.costing.length, 0); assert.deepEqual(h.calls.writes, []);
});
test('wrong source product identity is blocked before cost calculation', async () => {
  const h = harness(); h.state.operational.product.id = '1005000000000000';
  assert.equal((await h.post({ dryRun: true })).status, 422); assert.equal(h.calls.costing.length, 0);
});
for (const failure of ['pending', 'missing', 'null-freight', 'nan-cost', 'duplicate']) {
  test(`incomplete cost/freight ${failure} never writes`, async () => {
    const h = harness(); h.state.costFailure = failure; const r = await h.post({ dryRun: true }); assert.ok(r.status >= 400); assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.syncReads, []);
  });
}
test('provider outage never writes or returns cached costs', async () => {
  const h = harness(); h.state.providerFailure = true; assert.equal((await h.post({ dryRun: true })).status, 500); assert.deepEqual(h.calls.writes, []);
});
test('legacy no-body POST still updates every supplier SKU and synchronizes canonical availability', async () => {
  const h = harness({ allowWrites: true }); const r = await h.post(); assert.equal(r.status, 200); assert.equal(r.body.dryRun, undefined);
  assert.equal(r.body.variants, 2); assert.equal(r.body.activeMappings, 2); assert.ok(r.body.availability.length === 2);
  assert.equal(h.calls.writes.filter((x) => x === '$transaction').length, 2); assert.equal(h.calls.writes.filter((x) => x === 'supplierVariant.update').length, 2);
  assert.equal(h.calls.writes.filter((x) => x === 'productVariant.update').length, 2); assert.equal(h.calls.costing[0].readOnlySession, undefined);
});
test('explicit dryRun:false preserves legacy persisted behavior', async () => {
  const h = harness({ allowWrites: true }); const r = await h.post({ dryRun: false }); assert.equal(r.status, 200); assert.ok(h.calls.writes.includes('supplierProduct.update'));
});
test('explicit service syncAvailability:false still skips only canonical synchronization', async () => {
  const h = harness({ allowWrites: true }); const r = await h.service.refreshSupplier({ productId: 'product-1', supplierId: 'supplier-1', syncAvailability: false });
  assert.equal(r.availability, null); assert.equal(h.calls.writes.filter((x) => x === '$transaction').length, 1); assert.deepEqual(h.calls.syncReads, []);
});
test('refresh path remains behind actual admin proxy authentication', () => {
  const auth = loadTs('src/lib/manager-admin-auth.ts'); const { proxy } = loadTs('src/proxy.ts', {
    '@/lib/manager-admin-auth': { ...auth, managerAdminCredentialsFromEnv: () => ({ username: 'admin-fixture', password: 'fixture-password' }) },
  });
  const { NextRequest } = require('next/server'); const url = 'https://manager.test/api/products/product-1/suppliers/supplier-1/refresh';
  assert.equal(proxy(new NextRequest(url, { method: 'POST' })).status, 401);
  assert.equal(proxy(new NextRequest(url, { method: 'POST', headers: { Authorization: `Basic ${btoa('admin-fixture:fixture-password')}` } })).headers.get('x-middleware-next'), '1');
});

test('filtered current official SKU need not exist in old database mappings', async () => {
  const h = harness(); h.state.operational.product.sku_pricing[0].sku_id = 'new-official-sku';
  const r = await h.post({ dryRun: true, sourceSkuIds: ['new-official-sku'] });
  assert.equal(r.status, 200); assert.equal(r.body.quotedSkus[0].sourceSkuId, 'new-official-sku'); assert.deepEqual(h.calls.writes, []);
});
test('disabled or missing supplier fails without cost requests or writes', async () => {
  const h = harness(); h.state.supplier.status = 'DISABLED'; assert.equal((await h.post({ dryRun: true })).status, 422);
  h.state.supplier = null; assert.equal((await h.post({ dryRun: true })).status, 404); assert.equal(h.calls.provider.length, 0); assert.deepEqual(h.calls.writes, []);
});

function connectionHarness({ expiresSoon = true, allowRefresh = false } = {}) {
  const calls = { refreshes: 0, writes: [], decrypts: 0 };
  const state = { expiresAt: new Date(Date.now() + (expiresSoon ? 60_000 : 86_400_000)) };
  const connection = loadTs('src/lib/aliexpress-connection.ts', {
    './prisma': { prisma: {
      aliExpressConnection: new Proxy({
        findUnique: async () => ({
          ...state, refreshTokenCiphertext: 'fixture', refreshTokenIv: 'fixture', refreshTokenTag: 'fixture',
          accessTokenCiphertext: 'fixture', accessTokenIv: 'fixture', accessTokenTag: 'fixture',
          refreshExpiresAt: new Date(Date.now() + 86_400_000),
        }),
        upsert: async ({ update }) => {
          calls.writes.push('aliExpressConnection.upsert');
          if (!allowRefresh) throw new Error('Credential write forbidden');
          state.expiresAt = update.expiresAt; return { ...update, id: 'primary' };
        },
      }, { get(object, name) { if (!Object.hasOwn(object, name)) throw new Error(`Connection Prisma operation blocked: ${String(name)}`); return object[name]; } }),
    } },
    './aliexpress-token-crypto': {
      decryptSecret: () => { calls.decrypts++; return 'mock-token'; },
      encryptSecret: () => ({ ciphertext: 'fixture', iv: 'fixture', authTag: 'fixture' }),
    },
    './aliexpress-operational-client': { AliExpressOperationalClient: class {} },
    './aliexpress-oauth': {
      aliExpressConfig: () => ({ appKey: 'fixture', appSecret: 'fixture' }),
      refreshAliExpressToken: async () => {
        calls.refreshes++; if (!allowRefresh) throw new Error('OAuth refresh forbidden');
        return { accessToken: 'mock-refreshed', expiresAt: new Date(Date.now() + 86_400_000) };
      },
    },
  });
  return { connection, calls };
}
test('read-only session near expiry rejects instead of renewing or persisting OAuth', async () => {
  const h = connectionHarness(); await assert.rejects(h.connection.requireAliExpressSession({ readOnly: true }), /somente leitura/);
  assert.equal(h.calls.refreshes, 0); assert.deepEqual(h.calls.writes, []); assert.equal(h.calls.decrypts, 0);
});
test('read-only valid session decrypts in memory with no credential writes', async () => {
  const h = connectionHarness({ expiresSoon: false }); const session = await h.connection.requireAliExpressSession({ readOnly: true });
  assert.equal(session.session, 'mock-token'); assert.equal(h.calls.refreshes, 0); assert.deepEqual(h.calls.writes, []);
});
test('default session behavior still auto-renews and saves credentials', async () => {
  const h = connectionHarness({ allowRefresh: true }); await h.connection.requireAliExpressSession();
  assert.equal(h.calls.refreshes, 1); assert.deepEqual(h.calls.writes, ['aliExpressConnection.upsert']);
});
test('actual operational chain propagates read-only session flag to official product lookup', async () => {
  const sessions = [];
  const forbidden = async () => { throw new Error('Unexpected fallback call'); };
  const provider = loadTs('src/lib/aliexpress-operational-provider.ts', {
    './aliexpress-browser-provider': { getAliExpressBrowserProduct: forbidden },
    './aliexpress-catalog-id': aliases,
    './aliexpress-connection': {
      aliExpressConnectionStatus: async () => ({ connected: true }),
      requireAliExpressSession: async (opt) => {
        sessions.push(opt); return { session: 'mock-session', client: { getDropshipProduct: async () => ({}) } };
      },
    },
    './aliexpress-official-product-provider': { officialDropshipProductToOperationalProduct: () => ({ id: sourceId, title: 'Fixture', sku_pricing: [{ sku_id: 'sku-a', sale_price: 10 }] }) },
    './aliexpress-oxylabs-provider': { getAliExpressOxylabsProduct: forbidden },
    './aliexpress-scrapingbee-provider': { getAliExpressScrapingBeeProduct: forbidden },
    './omkar': { getOmkarProduct: forbidden },
  });
  assert.equal((await provider.getAliExpressOperationalProduct(sourceId, { readOnlySession: true })).provider, 'ALIEXPRESS_OPEN_PLATFORM');
  await provider.getAliExpressOperationalProduct(sourceId);
  assert.deepEqual(sessions, [{ readOnly: true }, undefined]);
});


test('unselected broken or out-of-stock styles do not consume quotes or invalidate the selected official SKU', async () => {
  const h = harness({ actualCosting: true }); h.state.operational.product.sku_pricing[1].sale_price = null;
  delete h.state.operational.product.sku_pricing[1].available_quantity;
  const r = await h.post({ dryRun: true, sourceSkuIds: ['sku-a'] });
  assert.equal(r.status, 200); assert.deepEqual(h.calls.freight.map((f) => f.skuId), ['sku-a']); assert.deepEqual(h.calls.writes, []);
});


for (const body of [{ dryrun: true }, { dryRun: true, sourceSkuIDs: [] }, { dryRun: true, sourceSkuIDs: ['sku-a'] }, { dryRun: true, unexpected: 'field' }]) {
  test(`public body rejects unknown option typo before reads/provider/writes: ${JSON.stringify(body)}`, async () => {
    const h = harness(); const r = await h.post(body);
    assert.equal(r.status, 400); assert.deepEqual(h.calls.reads, []); assert.deepEqual(h.calls.provider, []); assert.deepEqual(h.calls.writes, []);
  });
}

for (const scenario of ['missing-oauth', 'expired-oauth', 'status-error', 'session-renewal-required', 'official-api-error']) {
  test(`actual officialOnly provider chain never starts fallbacks: ${scenario}`, async () => {
    const calls = { fallback: [], sessions: 0, official: 0 };
    const fallback = (name) => async () => { calls.fallback.push(name); throw new Error('Forbidden fallback'); };
    const provider = loadTs('src/lib/aliexpress-operational-provider.ts', {
      './aliexpress-browser-provider': { getAliExpressBrowserProduct: fallback('browser') },
      './aliexpress-catalog-id': aliases,
      './aliexpress-connection': {
        aliExpressConnectionStatus: async () => {
          if (scenario === 'status-error') throw new Error('Read failed');
          return { connected: !['missing-oauth', 'expired-oauth'].includes(scenario) };
        },
        requireAliExpressSession: async (opt) => {
          calls.sessions++; assert.deepEqual(opt, { readOnly: true });
          if (scenario === 'session-renewal-required') throw new Error('Readonly session needs renewal');
          return { session: 'fixture-session', client: { getDropshipProduct: async () => { calls.official++; throw new Error('Official unavailable'); } } };
        },
      },
      './aliexpress-official-product-provider': { officialDropshipProductToOperationalProduct: () => { throw new Error('Must not parse failed request'); } },
      './aliexpress-oxylabs-provider': { getAliExpressOxylabsProduct: fallback('oxylabs') },
      './aliexpress-scrapingbee-provider': { getAliExpressScrapingBeeProduct: fallback('scrapingbee') },
      './omkar': { getOmkarProduct: fallback('omkar') },
    });
    await assert.rejects(provider.getAliExpressOperationalProduct(sourceId, { readOnlySession: true, officialOnly: true }), /alternativos desativados/);
    assert.deepEqual(calls.fallback, []);
    if (['missing-oauth', 'expired-oauth', 'status-error'].includes(scenario)) { assert.equal(calls.sessions, 0); assert.equal(calls.official, 0); }
  });
}

test('normal provider chain still uses fallbacks when officialOnly is omitted', async () => {
  const calls = []; const result = { id: globalId, title: 'Fallback fixture', sku_pricing: [{ sku_id: 'sku-a', sale_price: 10 }] };
  const unavailable = async () => { throw new Error('No fixture'); };
  const provider = loadTs('src/lib/aliexpress-operational-provider.ts', {
    './aliexpress-browser-provider': { getAliExpressBrowserProduct: unavailable },
    './aliexpress-catalog-id': aliases,
    './aliexpress-connection': { aliExpressConnectionStatus: async () => ({ connected: false }) },
    './aliexpress-official-product-provider': {},
    './aliexpress-oxylabs-provider': { getAliExpressOxylabsProduct: unavailable },
    './aliexpress-scrapingbee-provider': { getAliExpressScrapingBeeProduct: unavailable },
    './omkar': { getOmkarProduct: async () => { calls.push('omkar'); return result; } },
  });
  const r = await provider.getAliExpressOperationalProduct(sourceId); assert.equal(r.provider, 'OMKAR'); assert.deepEqual(calls, ['omkar']);
});

test('unfiltered dryRun also refuses nonofficial data defensively', async () => {
  const h = harness(); h.state.operational.provider = 'OMKAR';
  assert.equal((await h.post({ dryRun: true })).status, 422); assert.deepEqual(h.calls.costing, []); assert.deepEqual(h.calls.writes, []);
});


function scopedFixture({actualCosting=true}={}) {
  const h=harness({allowWrites:true,actualCosting});
  h.state.supplier.rawPayload={costingSourceSkuIds:['sku-a','sku-b']};
  h.state.operational.product.sku_pricing[1].available_quantity=5;
  h.state.operational.product.variants.find(g=>g.attribute_name==='Size').options.push({value_id:'l',name:'L'});
  const variant={id:'canonical-c',sourceSkuId:'sku-c',attributes:{Color:'Red',Size:'L'},stock:0,available:false};
  h.state.product.variants.push(variant);
  h.state.supplier.variants.push({id:'supplier-2',sourceSkuId:'sku-c',attributes:variant.attributes,stock:0,sourcePrice:null});
  h.state.supplier.mappings.push({id:'mapping-2',canonicalVariantId:'canonical-c',supplierVariantId:'supplier-2',active:true});
  h.state.operational.product.sku_pricing.push({sku_id:'sku-c',sale_price:1,available_quantity:0,variant_ids:'red,l',currency_code:'USD'});
  return h;
}
test('opt-in paid-flow refresh preserves all inventory and prices only available configured SKUs on repeated refresh',async()=>{
  const h=scopedFixture();
  for(let i=0;i<2;i++){
    const r=await h.service.refreshSupplier({productId:'product-1',supplierId:'supplier-1',syncAvailability:false});
    assert.equal(r.variants,3);assert.equal(r.activeMappings,3);
    assert.deepEqual(h.calls.costing[i].skuPricing.map(s=>s.sku_id),['sku-a','sku-b']);
    assert.deepEqual(h.state.supplier.rawPayload.costingSourceSkuIds,['sku-a','sku-b']);
    assert.equal(h.state.supplier.rawPayload.costSnapshot.status,'COMPLETE');
    assert.equal(h.state.supplier.variants.find(v=>v.sourceSkuId==='sku-a').sourcePrice,14);
    assert.equal(h.state.supplier.variants.find(v=>v.sourceSkuId==='sku-b').sourcePrice,24);
    assert.equal(h.state.supplier.variants.find(v=>v.sourceSkuId==='sku-c').sourcePrice,null);
    assert.equal(h.state.supplier.variants.find(v=>v.sourceSkuId==='sku-c').stock,0);
    assert.deepEqual(h.calls.provider[i],[sourceId,{officialOnly:true}]);
  }
  assert.equal(h.calls.freight.length,4);assert.ok(h.calls.freight.every(x=>x.skuId!=='sku-c'));assert.deepEqual(h.calls.syncReads,[]);
});
test('scoped sold-out inventory updates to zero with no freight requests or invented prices',async()=>{
  const h=scopedFixture();for(const s of h.state.operational.product.sku_pricing)s.available_quantity=0;
  await h.service.refreshSupplier({productId:'product-1',supplierId:'supplier-1',syncAvailability:false});
  assert.equal(h.calls.freight.length,0);assert.equal(h.calls.costing.length,0);
  for(const s of h.state.supplier.variants){assert.equal(s.stock,0);assert.equal(s.sourcePrice,null);}
  assert.equal(h.state.supplier.rawPayload.costSnapshot.status,'PENDING_FREIGHT');
  assert.deepEqual(h.state.supplier.rawPayload.costingSourceSkuIds,['sku-a','sku-b']);
});
test('scope with only one available configured SKU does not request freight for a newly sold-out sibling',async()=>{
  const h=scopedFixture();h.state.operational.product.sku_pricing[0].available_quantity=0;
  await h.service.refreshSupplier({productId:'product-1',supplierId:'supplier-1',syncAvailability:false});
  assert.deepEqual(h.calls.costing[0].skuPricing.map(s=>s.sku_id),['sku-b']);assert.equal(h.calls.freight.length,1);
  assert.equal(h.state.supplier.variants.find(v=>v.sourceSkuId==='sku-a').stock,0);
  assert.equal(h.state.supplier.variants.find(v=>v.sourceSkuId==='sku-b').sourcePrice,24);
});
for(const scope of [[],['sku-a','sku-a'],['missing'],[' sku-a']])test('invalid or missing scoped identity rejects without source writes: '+JSON.stringify(scope),async()=>{
  const h=scopedFixture();h.state.supplier.rawPayload={costingSourceSkuIds:scope};const r=await h.post({});assert.equal(r.status,422);assert.deepEqual(h.calls.writes,[]);
});
test('unknown scoped stock rejects without guessing sold-out inventory',async()=>{
  const h=scopedFixture();h.state.operational.product.sku_pricing[0].available_quantity=null;const r=await h.post({});assert.equal(r.status,422);assert.deepEqual(h.calls.writes,[]);
});
test('scoped refresh rejects non-US/USD costs before any write',async()=>{
  const h=scopedFixture({actualCosting:false});h.state.costFailure='foreign';const r=await h.post({});assert.equal(r.status,422);assert.deepEqual(h.calls.writes,[]);
});
test('explicit dry-run selection keeps read-only semantics even when supplier has a configured normal-refresh scope',async()=>{
  const h=scopedFixture({actualCosting:false});const r=await h.post({dryRun:true,sourceSkuIds:['sku-a']});assert.equal(r.status,200);assert.equal(r.body.persisted,false);assert.deepEqual(h.calls.writes,[]);assert.deepEqual(h.calls.provider[0],[sourceId,{readOnlySession:true,officialOnly:true}]);assert.deepEqual(h.calls.costing[0].skuPricing.map(s=>s.sku_id),['sku-a']);
});
