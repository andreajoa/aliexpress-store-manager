# AliExpress Store Manager — Online Runbook

## Architecture

The Store Manager is an independent application. Compatible stores expose the connector protocol and an explicit publication target. The Manager must never infer repository paths or write directly to a store's base branch.

## Required production environment variables

Set these only in the hosting platform. Never commit their values.

### Core
- `DATABASE_URL` — pooled Neon PostgreSQL connection used by the application.
- `DIRECT_URL` — direct Neon connection used by migrations/administrative database work when required by the Prisma configuration.
- `MANAGER_ADMIN_USER` — administrative HTTP Basic username.
- `MANAGER_ADMIN_PASSWORD` — strong administrative HTTP Basic password.
- `OMKAR_API_KEY` — AliExpress operational import/refresh data.
- `CRON_SECRET` — independent Bearer secret for the maintenance synchronization endpoint.

### Copy optimization
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (optional when the application default is acceptable)

### Editorial Studio
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_IMAGE_MODEL`
- `CLOUDFLARE_AUDIT_MODEL`
- `CLOUDFLARE_TEXT_MODEL` when configured by the current editorial flow

### Publication lifecycle
- `GITHUB_PUBLISH_TOKEN` — least-privilege token restricted to repositories the Manager is allowed to publish to.
- `VERCEL_TOKEN` — used only to discover/verify Preview deployments and production deployments declared by a compatible store.

### AliExpress Open Platform
- `ALIEXPRESS_APP_KEY` — App Key from the authorized AliExpress Developer application.
- `ALIEXPRESS_APP_SECRET` — App Secret, server-side only.
- `ALIEXPRESS_OAUTH_REDIRECT_URI` — exact HTTPS callback URL ending in `/api/aliexpress/oauth/callback`.
- `ALIEXPRESS_TOKEN_ENCRYPTION_KEY` — independent Base64-encoded 32-byte key used only to encrypt the AliExpress access token at rest.
- `ALIEXPRESS_SEND_GOODS_COUNTRY` — optional supplier-origin country; defaults to `CN`.
- `ALIEXPRESS_PAYMENT_URL` — optional payment/orders URL override.

The AliExpress application must have the required AE-Dropshipper APIs authorized before automatic supplier-order creation can be enabled. An imported numeric supplier SKU is never treated as the purchase `sku_attr`; the Manager obtains and maps the official `sku_attr` from the authorized product API.

### Optional enrichment
- `SCRAPINGBEE_API_KEY`

`LOCAL_EXPORTS_ENABLED` should not be enabled on serverless production. Local export remains a local-development feature.

## Public routes

Only these routes intentionally bypass the Manager administrative login:
- `GET /api/health`
- `POST /api/stores/:storeId/orders/webhook`
- `GET /api/aliexpress/oauth/callback` — protected by the short-lived HttpOnly OAuth state cookie.
- `GET /api/cron/maintenance` — protected independently by `Authorization: Bearer <CRON_SECRET>`.
- Next.js static/image assets and basic browser metadata files

The order webhook is not anonymous: it requires the Bearer token generated for that individual store. Only the hash is retained in the Manager database.

## Store order integration

For each connected store:
1. Generate a webhook token in the Manager store panel.
2. Put the Manager webhook endpoint in the store hosting environment as `STORE_MANAGER_WEBHOOK_URL`.
3. Put the one-time plaintext token in the store hosting environment as `STORE_MANAGER_WEBHOOK_TOKEN`.
4. Redeploy the store.
5. Verify a Stripe test checkout. A Store Manager failure must never make the Stripe webhook fail; delivery is best-effort and idempotent.

Mixed carts are transmitted with `scope=MANAGED_ITEMS`. The Manager receives only products it owns, while preserving `sourceOrderTotalCents` from the complete store payment. Shipping or discounts belonging to legacy items are never invented or attributed to the managed subset.

## Publication safety

A real publication requires all publication blockers to be cleared. The Manager creates a dedicated publication branch and draft PR, waits for a Vercel Preview, verifies the rendered product, requires explicit approval, merges only the exact verified head SHA, then verifies production.

Never bypass:
- age provenance requirements;
- editorial audit/content availability;
- explicit `publicationTarget` contract;
- variant/SKU integrity;
- Preview verification;
- production verification.

## Supplier engine

A commercial product may have PRIMARY, BACKUP and ALTERNATIVE suppliers. Supplier selection is fail-closed and requires:
- active supplier;
- recent supplier data;
- complete canonical variant mapping;
- valid cost;
- sufficient stock after active fulfillment reservations.

Policy precedence is PRIMARY → BACKUP → ALTERNATIVE. Cost only breaks ties within the same policy/priority and comparable currency.

A fulfillment batch may switch supplier only while still `PROCESSING` and before an external supplier order ID has been recorded. Every switch is revalidated transactionally and audited.

## AliExpress fulfillment

When an authorized AliExpress Open Platform connection is available, the Manager can:
1. fetch the official supplier SKU attributes for the customer's destination;
2. keep the existing canonical variant mapping as the source of truth;
3. calculate available shipping methods;
4. create an unpaid AliExpress supplier order with the exact product, variant, quantity and customer shipping address;
5. persist the returned AliExpress order ID on the fulfillment batch;
6. synchronize order/logistics information and tracking afterward.

The access token is encrypted before persistence. Payment-card data is never stored by the Manager. The operator confirms payment in the authorized AliExpress environment.

Supplier-order placement is fail-closed. A request starts with a placement lock. If the remote result is uncertain after the request may have reached AliExpress, the batch becomes `UNKNOWN` and automatic retry is blocked. A new attempt is allowed only after the operator explicitly verifies that no supplier order exists.

If Open Platform credentials or required permissions are unavailable, the existing fulfillment package/manual-order fallback remains available; the Manager must never simulate a successful supplier order.

## Maintenance synchronization

`GET /api/cron/maintenance` refreshes active AliExpress supplier data and synchronizes already-created AliExpress orders/tracking in bounded batches. It is protected by `CRON_SECRET` and can be invoked by Vercel Cron or another trusted scheduler. Scheduler frequency must respect the hosting plan's supported cadence.

## Editorial persistence

New editorial binaries are stored durably in PostgreSQL with SHA-256, MIME type and byte size. `.data/editorials` is only a local-development/backward-compatibility fallback. An old asset that existed only on a developer machine remains unavailable online until it is regenerated or explicitly hydrated; the Manager must not mark a missing binary as valid.

## Deployment gate

Before declaring production ready:
1. Apply and verify all pending database migrations on a temporary Neon branch.
2. Promote the tested migration to the production branch only after explicit approval.
3. Import/deploy the Manager Vercel project from `andreajoa/aliexpress-store-manager`.
4. Set all required server-side variables.
5. Confirm `/api/health` reports `database=connected`, `productionCoreReady=true`, and eventually `fullFeatureReady=true`.
6. Configure the AliExpress Developer app callback, then authorize the buyer account from `/settings/aliexpress`.
7. Generate the store webhook credential and set it in the storefront Vercel project.
8. Run a Stripe test-mode `order.paid` E2E.
9. Run supplier SKU synchronization and freight calculation against an authorized AliExpress account.
10. Run publication dry-run and repository dry-run.
11. Do not create a real supplier order in an acceptance test without explicit operator confirmation because `placeorder` creates a real unpaid order in the connected AliExpress account.
12. Do not publish the current real test product until its required age evidence is actually supplied.
