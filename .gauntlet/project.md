# AMB Manager complete catalog scan

Next.js 16.3 / TypeScript / Prisma Manager for AMB supplier inventory and
fulfilment mappings. This branch fixes only GitHub catalog fallback completeness.
The previous fallback read generated-products.ts alone and missed imported
dresses, shoes, bags, workwear and October color products.

Current reviewed catalogs: 451 published and 452 local, including all 444
established products. New approved products may increase these totals. Keep
existing binding behavior, US Size identity and reservation behavior. No
repricing, production writes, merge, deployment, email or CRM actions in this
verification phase.
