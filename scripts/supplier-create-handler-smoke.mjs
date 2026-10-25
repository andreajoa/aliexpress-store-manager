import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const globalId = '1005007757686921';
const regionalId = '3256807571372169';
const routeFile = 'src/app/api/products/[id]/suppliers/route.ts';

// Execute the actual TS handler. Only an explicit import whitelist is allowed;
// Prisma and every network-capable provider are replaced before module loading.
function loadTs(file, imports = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const isolatedRequire = (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === 'zod' || name === 'next/server') return require(name);
    throw new Error(`Unmocked import blocked: ${name}`);
  };
  new Function('require', 'module', 'exports', 'console', code)(
    isolatedRequire, loadedModule, loadedModule.exports, { ...console, error() {} },
  );
  return loadedModule.exports;
}
const aliases = loadTs('src/lib/aliexpress-catalog-id.ts');
const catalog = loadTs('src/lib/supplier-catalog.ts');
const mapper = loadTs('src/lib/supplier-variant-mapper.ts');

function harness() {
  const calls = { provider: [], costing: [], duplicates: [], transactions: [], demotions: [], creates: [], mappings: [] };
  const product = {
    id: 'canonical-product',
    variants: [
      { id: 'canonical-38', sourceSkuId: 'sku-38', attributes: { Color: 'Black', Size: '38' } },
      { id: 'canonical-39', sourceSkuId: 'sku-39', attributes: { Color: 'Black', Size: '39' } },
    ],
  };
  const operational = {
    provider: 'ALIEXPRESS_OPEN_PLATFORM', requestedProductId: regionalId, resolvedProductId: globalId,
    warnings: ['regional URL resolved to global catalog'],
    product: {
      id: globalId, title: 'Fixture shoes', currency: 'EUR', seller: { id: 'seller', name: 'Fixture seller' },
      official_sku_attrs: { 'sku-38': '14:193#Black;200000124:200000333#38', 'sku-39': '14:193#Black;200000124:200000334#39' },
      listing_url: `https://www.aliexpress.com/item/${globalId}.html`,
      variants: [
        { attribute_name: 'Color', options: [{ value_id: 'black', name: 'Black', image_url: 'https://example.test/black.jpg' }] },
        { attribute_name: 'Size', options: [{ value_id: '38', name: '38' }, { value_id: '39', name: '39' }] },
      ],
      sku_pricing: [
        { sku_id: 'sku-38', variant_ids: 'black,38', sale_price: 10, available_quantity: 3 },
        { sku_id: 'sku-39', variant_ids: 'black,39', sale_price: 20, available_quantity: 7 },
      ],
    },
  };
  const costing = {
    complete: true, warning: null, costCurrency: 'USD', costMin: 15, costMax: 29,
    costedSkus: operational.product.sku_pricing.map((sku, index) => ({
      sku, itemPrice: sku.sale_price, itemCurrency: 'EUR', costCurrency: 'USD',
      itemCostInCostCurrency: index ? 22 : 11, freightCostInCostCurrency: index ? 7 : 4,
      landedCost: index ? 29 : 15,
    })),
    snapshot: { status: 'COMPLETE', basis: 'ITEM_PLUS_FREIGHT', countryCode: 'US', costCurrency: 'USD', freight: { status: 'AVAILABLE' } },
  };
  const state = { product, operational, costing, existing: null, lateDuplicate: null, providerError: null, costingError: null, createError: false, resolvedId: regionalId };
  let created;
  const findDuplicate = async ({ where }, existing) => {
    calls.duplicates.push(where);
    return existing && where.sourceProductId.in.includes(existing.sourceProductId) ? { id: existing.id } : null;
  };
  const prisma = {
    product: { findUnique: async () => state.product },
    supplierProduct: { findFirst: (args) => findDuplicate(args, state.existing) },
    $transaction: async (callback, options) => {
      calls.transactions.push(options);
      return callback({
        supplierProduct: {
          findFirst: (args) => findDuplicate(args, state.lateDuplicate),
          updateMany: async (args) => { calls.demotions.push(args); return { count: 1 }; },
          create: async (args) => {
            calls.creates.push(args);
            if (state.createError) throw new Error('simulated database failure');
            created = {
              ...args.data, id: 'new-supplier',
              variants: args.data.variants.create.map((v, i) => ({ ...v, id: `supplier-variant-${i}` })),
              mappings: [],
            };
            return created;
          },
          findUniqueOrThrow: async () => created,
        },
        supplierVariantMapping: { createMany: async (args) => { calls.mappings.push(args); created.mappings = args.data.map((m, i) => ({ ...m, id: `mapping-${i}` })); } },
      });
    },
  };
  const route = loadTs(routeFile, {
    '@/lib/prisma': { prisma },
    '@/lib/omkar': { resolveAliExpressProductId: async () => state.resolvedId },
    '@/lib/aliexpress-catalog-id': aliases,
    '@/lib/aliexpress-operational-provider': { getAliExpressOperationalProduct: async (id) => {
      calls.provider.push(id); if (state.providerError) throw state.providerError; return state.operational;
    } },
    '@/lib/aliexpress-import-costing': { buildAliExpressImportCosting: async (input) => {
      calls.costing.push(input); if (state.costingError) throw state.costingError; return state.costing;
    } },
    '@/lib/supplier-catalog': catalog,
    '@/lib/supplier-variant-mapper': mapper,
  });
  return { state, calls, async post(body = { url: `https://www.aliexpress.us/item/${regionalId}.html`, role: 'PRIMARY' }) {
    const response = await route.POST(new Request('https://manager.test/api/products/canonical-product/suppliers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: 'canonical-product' }) });
    return { status: response.status, body: await response.json() };
  } };
}

// Any accidental real HTTP call from a newly added dependency must fail closed.
globalThis.fetch = async () => { throw new Error('Real network forbidden in supplier handler tests'); };

test('official success stores per-SKU item + freight, FX currency, metadata and confirmed mappings', async () => {
  const h = harness(); const result = await h.post();
  assert.equal(result.status, 201); assert.equal(result.body.mappingStatus, 'CONFIRMED_AUTO');
  assert.deepEqual(h.calls.provider, [regionalId]);
  assert.equal(h.calls.costing[0].productId, globalId); assert.equal(h.calls.costing[0].itemCurrency, 'EUR');
  const data = h.calls.creates[0].data;
  assert.equal(data.sourceProductId, globalId); assert.equal(data.role, 'PRIMARY'); assert.equal(data.priority, 0);
  assert.equal(data.sourceCurrency, 'USD'); assert.equal(data.costMin, 15); assert.equal(data.costMax, 29);
  assert.deepEqual(data.variants.create.map((v) => [v.sourceSkuId, v.sourcePrice, v.stock]), [['sku-38', 15, 3], ['sku-39', 29, 7]]);
  assert.equal(data.variants.create[0].imageUrl, 'https://example.test/black.jpg');
  assert.equal(data.variants.create[0].orderSkuAttr, h.state.operational.product.official_sku_attrs['sku-38']);
  assert.equal(data.variants.create[1].orderSkuAttr, h.state.operational.product.official_sku_attrs['sku-39']);
  assert.equal(data.rawPayload.operationalProvider, 'ALIEXPRESS_OPEN_PLATFORM');
  assert.deepEqual(data.rawPayload.costSnapshot, h.state.costing.snapshot);
  assert.equal(data.rawPayload.requestedProductId, regionalId); assert.equal(data.rawPayload.resolvedProductId, globalId);
  assert.equal(h.calls.demotions.length, 1); assert.equal(h.calls.mappings[0].data.length, 2);
  assert.equal(result.body.supplier.variants[1].sourcePrice, '29');
  assert.equal(h.calls.transactions[0].isolationLevel, 'Serializable');
});

for (const [role, priority] of [['BACKUP', 50], ['ALTERNATIVE', 100]]) {
  test(`${role} preserves priority and does not demote the primary`, async () => {
    const h = harness(); const result = await h.post({ url: 'https://example.test/item', role });
    assert.equal(result.status, 201); assert.equal(h.calls.creates[0].data.priority, priority); assert.equal(h.calls.demotions.length, 0);
  });
}

test('fallback operational result uses the same costing path', async () => {
  const h = harness(); h.state.operational.provider = 'OMKAR'; h.state.operational.product.id = regionalId; h.state.operational.resolvedProductId = regionalId;
  delete h.state.operational.product.official_sku_attrs;
  const result = await h.post(); assert.equal(result.status, 201);
  assert.equal(h.calls.costing[0].productId, regionalId); assert.equal(h.calls.creates[0].data.variants.create[0].sourcePrice, 15);
  assert.equal(h.calls.creates[0].data.variants.create[0].orderSkuAttr, null);
});

for (const [requested, existing] of [[regionalId, globalId], [globalId, regionalId], [regionalId, regionalId]]) {
  test(`duplicate ${requested} / ${existing} returns existing supplier before provider or writes`, async () => {
    const h = harness(); h.state.resolvedId = requested; h.state.existing = { id: 'already-linked', sourceProductId: existing };
    const result = await h.post(); assert.equal(result.status, 409); assert.equal(result.body.supplierId, 'already-linked');
    assert.equal(h.calls.provider.length, 0); assert.equal(h.calls.transactions.length, 0);
  });
}

test('supplier linked during external calls is rejected before primary demotion', async () => {
  const h = harness(); h.state.lateDuplicate = { id: 'linked-in-meantime', sourceProductId: regionalId };
  const result = await h.post(); assert.equal(result.status, 409); assert.equal(h.calls.demotions.length, 0); assert.equal(h.calls.creates.length, 0);
});

for (const scenario of ['pending freight', 'missing SKU cost', 'null landed cost', 'invalid freight', 'duplicate cost SKU', 'wrong currency', 'pending snapshot']) {
  test(`${scenario} fails before transaction and primary demotion`, async () => {
    const h = harness();
    if (scenario === 'pending freight') { h.state.costing.complete = false; h.state.costing.warning = 'US freight unavailable'; }
    if (scenario === 'missing SKU cost') h.state.costing.costedSkus.pop();
    if (scenario === 'null landed cost') h.state.costing.costedSkus[1].landedCost = null;
    if (scenario === 'invalid freight') h.state.costing.costedSkus[1].freightCostInCostCurrency = NaN;
    if (scenario === 'duplicate cost SKU') h.state.costing.costedSkus.push(h.state.costing.costedSkus[0]);
    if (scenario === 'wrong currency') h.state.costing.costedSkus[0].costCurrency = 'EUR';
    if (scenario === 'pending snapshot') h.state.costing.snapshot.freight.status = 'PENDING';
    const result = await h.post(); assert.equal(result.status, 500); assert.equal(result.body.ok, false);
    assert.equal(h.calls.transactions.length, 0); assert.equal(h.calls.demotions.length, 0);
  });
}

for (const phase of ['provider', 'costing']) {
  test(`${phase} outage leaves suppliers untouched`, async () => {
    const h = harness(); h.state[`${phase}Error`] = new Error(`${phase} unavailable`);
    const result = await h.post(); assert.equal(result.status, 500); assert.equal(h.calls.transactions.length, 0);
  });
}

test('unrelated product returned by provider is rejected before freight or writes', async () => {
  const h = harness(); h.state.operational.product.id = '1005000000000000';
  const result = await h.post(); assert.equal(result.status, 500); assert.equal(h.calls.costing.length, 0); assert.equal(h.calls.transactions.length, 0);
});

test('ambiguous variant correspondence remains review-required without auto mappings', async () => {
  const h = harness(); h.state.product.variants = [{ id: 'unmatched', attributes: { Color: 'Red', Size: '90' } }];
  const result = await h.post(); assert.equal(result.status, 201); assert.equal(result.body.mappingStatus, 'REVIEW_REQUIRED'); assert.equal(h.calls.mappings.length, 0);
});

test('bad input and missing product preserve existing API responses', async () => {
  const h = harness(); assert.equal((await h.post({ url: 'invalid', role: 'PRIMARY' })).status, 400);
  assert.equal((await h.post({ url: 'https://example.test', role: 'INVALID' })).status, 400);
  h.state.product = null; assert.equal((await h.post()).status, 404); assert.equal(h.calls.provider.length, 0);
});

test('supplier POST path still requires admin authentication through the actual proxy', () => {
  const auth = loadTs('src/lib/manager-admin-auth.ts');
  const { proxy } = loadTs('src/proxy.ts', {
    '@/lib/manager-admin-auth': {
      ...auth,
      managerAdminCredentialsFromEnv: () => ({ username: 'fixture-admin', password: 'fixture-password' }),
    },
  });
  const { NextRequest } = require('next/server');
  const url = 'https://manager.test/api/products/product-1/suppliers';
  assert.equal(proxy(new NextRequest(url, { method: 'POST' })).status, 401);
  const authorized = proxy(new NextRequest(url, {
    method: 'POST', headers: { Authorization: `Basic ${btoa('fixture-admin:fixture-password')}` },
  }));
  assert.equal(authorized.headers.get('x-middleware-next'), '1');
  assert.equal(proxy(new NextRequest(url, {
    method: 'POST', headers: { Authorization: `Basic ${btoa('fixture-admin:wrong-password')}` },
  })).status, 401);
});
