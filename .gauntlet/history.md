# October4

User clarified saved prices and then authorized fresh supplier cost verification with markup3x. Live UI query:9families have saved prices, CM.YAYA/rhinestone sale fields empty. Native refresh reproduced5000ms expired-transaction faults at55/64SKUs. Prepared isolated atomic timeout fix. Existing known stock/consent/email histories preserved.

## October 5 — complete GitHub catalog fallback

Replaced generated-products-only fallback with a bounded static AST reader for
all nine catalog modules. GitHub resolves the branch once and pins all contents
requests to that immutable commit. The composite digest covers every source
and blob SHA. Changed helper semantics/composition fail before persistence.
TypeScript 5.9.3 is pinned as a runtime dependency for parsing and printer hashes.

Verified 451 published rows through real read-only GitHub loading and 452 local
rows through committed fixtures and the storefront checkout. All 444 baseline
rows compare exactly. Existing binding loop was preserved; bridge, US Size and
reservation smoke tests passed. Build, typecheck and affected-file ESLint passed.
Added growth regression coverage for approved future rows and excluded drafts.
No repricing, migration, production write, merge or deployment was performed.

Independent critic reproduced an accepted top-level `octoberColorProducts.splice`
mutation that changed runtime catalog rows. Added fingerprints of the complete
module structure with passive data initializers excluded, and validated every
initializer expression including fields omitted from Manager snapshots. Tests
now reject top-level calls, mutating initializers, side-effect imports and
executable data fields. Both reviewed catalogs and the production build passed
again after the guard change.
