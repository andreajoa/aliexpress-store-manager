# Complete scan acceptance

- BLOCKER: all catalog rows and supplier identities exactly match the reviewed
  release, including 444 established products; deep equality in the smoke test.
- BLOCKER: one immutable GitHub commit supplies every module; mocked transport
  verifies all nine reads share its ref, and real read validates published rows.
- BLOCKER: unknown syntax, imports or changed transformations fail before writes;
  mutation fixtures reject unsupported catalog expressions without eval.
- MAJOR: every module affects the scan digest; changed imported blob invalidates
  caching even when generated-products.ts is unchanged.
- MAJOR: approved future additions appear and unapproved additions stay excluded;
  smoke test checks the release can grow without a fixed count cap.
- MAJOR: historical binding, ambiguity, US Size and inventory reservations remain
  covered by existing smoke tests; scan persistence loop is unchanged.
- MAJOR: TypeScript, affected-file ESLint and production build pass; independent
  critic finds no unresolved blocker or major issue.
- Production deployment and live manual scan require a separate authorized step.
