# AMB complete catalog fixtures

These non-secret storefront modules snapshot the reviewed October 5, 2026 local
release: 444 established products and eight approved additions (452 total).
`baseline.json` records the 444 established catalog rows independently of the
new static repository reader. `release.json` contains the reviewed allowlist.

The smoke test compares every slug, name, color, size, stock, cost and supplier
identity, checks immutable GitHub reads and invalidation across imported modules,
rejects unsupported transformations, and verifies future approved additions and
unapproved exclusions. It never executes the fixture modules or writes externally.

Run `npm run test:amb-catalog-repository` for the committed fixture or
`npm run test:amb-catalog-repository -- /path/to/storefront` for a reviewed checkout
with `imports/products-20261004-release.json`. Update the module fixtures and
release allowlist together when adding a reviewed release. Preserve the baseline
unless an independently approved established-product change requires updating it.

The production loader supports the known catalog composition and helper
semantics only. A changed transformation or added module must be explicitly
supported in `amb-catalog-repository.ts`; its fingerprint is based on the pinned
TypeScript printer version. Such changes fail before the scan writes bindings.
