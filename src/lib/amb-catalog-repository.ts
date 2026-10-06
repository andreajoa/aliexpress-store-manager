import { createHash } from "node:crypto";
import ts from "typescript";
import type { AmbCatalogProduct } from "./amb-catalog-detector.ts";

/** A bounded reader for AMB's known catalog DSL. Never executes repository code. */
const paths = [
  "app/data.ts", "app/generated-products.ts", "app/generated-august-2026-products.ts",
  "app/generated-september-2026-products.ts", "app/shoe-products.ts",
  "app/generated-supplemental-products.ts", "app/work-products.ts",
  "app/october-color-products.ts", "app/october-source-lineage.ts",
] as const;
export const ambCatalogRepositoryPaths = paths;

type RepositoryFile = { source: string; blobSha: string };
type Row = Record<string, unknown>;
function fail(detail: string): never { throw new Error(`Catálogo AMB não suportado: ${detail}.`); }
function moduleSource(path: string, source: string) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) fail(`${path}: sintaxe inválida`);
  return file;
}
// Only these data initializers may change without a reader update. Everything
// else (imports, helpers and top-level statements) is fingerprinted together.
const dataInitializers: Record<string, string[]> = {
  "app/data.ts": ["placeholderProducts", "categoryPages"],
  "app/generated-products.ts": ["allGeneratedProducts", "ESTABLISHED_CATALOGUE_COUNT", "approvedNewProductSlugs"],
  "app/generated-august-2026-products.ts": ["dressFamilies"],
  "app/generated-september-2026-products.ts": ["dressFamilies"],
  "app/generated-supplemental-products.ts": ["bagProducts"],
  "app/shoe-products.ts": ["s3343", "s3346", "s3441", "s3440", "shoeProducts"],
  "app/work-products.ts": ["workProducts"],
  "app/october-color-products.ts": ["octoberColorProducts"],
  "app/october-source-lineage.ts": ["octoberSourceLineage"],
};
const moduleShapeHashes: Record<string, string> = {
  "app/data.ts": "b6b38da97572b20bd63f651af003c06df804eff771a66400b7600a044082c2f8",
  "app/generated-products.ts": "6a9341e80a9a508230915148c45eae5fc09292d04481a946c4308bd47bb7c019",
  "app/generated-august-2026-products.ts": "c23fc5c02acc89bc0a882abc88568ee0a25536b42a7af8b58af9d4ff7f7293f7",
  "app/generated-september-2026-products.ts": "fb12224c8e70cd04ffaee5785a99e2a9fdd158eda5b063a7268c729665b4f682",
  "app/generated-supplemental-products.ts": "3b85d7cd2f424f44f0a1e174965e3538cc64739a5558bafbee52b1e804b1f1d7",
  "app/shoe-products.ts": "3b32418277d5d51d4b64daa743b44f4bfd82549c13db3f3aaee5073e3750153e",
  "app/work-products.ts": "03fdc945ce67f0d4e73544d75a1facdbc220a744e24c6ba27ed71005e0e952e0",
  "app/october-color-products.ts": "e24f3eaebb666b500e748b1dc4ef0c2eef349415e4d3969330d0c5d97319c37c",
  "app/october-source-lineage.ts": "b1ed1853713dccdda3156c691b78332d9fc80d2bd4231a02cda3ded502539694",
};
const dataReferences = new Set([
  "august2026Products", "september2026Products", "august2026ProductSlugs", "september2026ProductSlugs",
  "s3343", "s3346", "s3441", "s3440", "WOVEN", "CRYSTAL", "SYNTHETIC", "fourViewSprite",
  "wovenDescription", "crystalSandalDescription", "crystalSlingbackDescription", "buckleSlingbackDescription",
  "bucklePumpDescription", "patentDescription", "glossDescription", "bowDescription",
]);
function requireDataExpression(node: ts.Expression, factories: string[]) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)
    || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return;
  if (ts.isIdentifier(node) && dataReferences.has(node.text)) return;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return;
  if (ts.isArrayLiteralExpression(node)) { for (const item of node.elements) requireDataExpression(item, factories); return; }
  if (ts.isSpreadElement(node)) { requireDataExpression(node.expression, factories); return; }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) fail("dados com propriedade executável");
      if ((ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === "__proto__") fail("protótipos não são permitidos nos dados do catálogo");
      requireDataExpression(property.initializer, factories);
    }
    return;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && factories.includes(node.expression.text)) {
    for (const argument of node.arguments) requireDataExpression(argument, []);
    return;
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Set" && node.arguments?.length === 1) {
    requireDataExpression(node.arguments[0], []); return;
  }
  fail("expressão executável nos dados do catálogo");
}
function requireModuleShape(file: ts.SourceFile) {
  const names = dataInitializers[file.fileName];
  const factories = file.fileName === "app/shoe-products.ts" ? ["fixed", "variable"]
    : file.fileName === "app/generated-supplemental-products.ts" ? ["bag"]
    : file.fileName === "app/work-products.ts" ? ["sheet"] : [];
  const result = ts.transform(file, [(context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer) {
        requireDataExpression(node.initializer, factories);
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, ts.factory.createIdentifier("__AMB_CATALOG_DATA__"));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  const printed = ts.createPrinter({ removeComments: true }).printFile(result.transformed[0]);
  result.dispose();
  if (createHash("sha256").update(printed).digest("hex") !== moduleShapeHashes[file.fileName]) fail(`${file.fileName}: estrutura do módulo alterada`);
}
function assignment(file: ts.SourceFile, name: string): ts.Expression {
  const declarations = file.statements.flatMap((statement) => ts.isVariableStatement(statement)
    ? [...statement.declarationList.declarations].filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)
    : []);
  if (declarations.length !== 1 || !declarations[0].initializer) fail(`${file.fileName}: ${name}`);
  return declarations[0].initializer;
}
// These hashes cover only the known transformation expressions, not product
// data. Changed helper semantics require an explicit reader update; otherwise
// the scanner fails before writing a partial or misleading catalog snapshot.
const transformHashes: Record<string, string> = {
  shell: "4b4917c51da7232a9d7d3111f0628ee8c76868142b34325a879f3481d9e8ce82",
  fixed: "af2783423705a81987cd0791790e777328f1ff6776fe97326cf02d52f06d22cf",
  variable: "4c91d8bece3761d9d4b0d81337c639548085db6d446207004d4ced1afc508ea7",
  bag: "50d4b8d9c81f6a037416e63c2ec1cf4a698038bd16d93727ec5d45ce61ce47f8",
  august2026Products: "c4eb61f497cea342537d155f3216acc00727bdb73507e210a6531ac3275cf2a9",
  september2026Products: "c4eb61f497cea342537d155f3216acc00727bdb73507e210a6531ac3275cf2a9",
  catalogueProducts: "6110c0a05bffe398a12a94de6883b0e2e606e7dfc569f19a0f7c37fc03e91068",
  establishedSlugs: "e7efd94e72939e48c0595c960af93309479dc21c543a7fd1a2a0222c04038417",
};
function requireTransform(file: ts.SourceFile, name: string, functionBody = false) {
  const node = functionBody
    ? file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    : assignment(file, name);
  if (!node) fail(`${file.fileName}: transformação ${name} ausente`);
  const printed = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, node, file);
  if (createHash("sha256").update(printed).digest("hex") !== transformHashes[name]) fail(`${file.fileName}: transformação ${name} alterada`);
}
function array(node: ts.Expression): ts.NodeArray<ts.Expression> {
  if (!ts.isArrayLiteralExpression(node)) fail("array literal obrigatório");
  return node.elements;
}
function literal(node: ts.Expression, file?: ts.SourceFile): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => literal(item, file));
  if (ts.isIdentifier(node) && file && /^s\d{4}$/.test(node.text)) return literal(assignment(file, node.text));
  fail("apenas valores literais são permitidos");
}
function fields(node: ts.Expression, keys: string[], file?: ts.SourceFile): Row {
  if (!ts.isObjectLiteralExpression(node)) fail("objet literal obrigatório");
  const row: Row = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) fail("propriedade de catálogo não literal");
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : "";
    if (keys.includes(name)) {
      if (Object.prototype.hasOwnProperty.call(row, name)) fail(`campo duplicado: ${name}`);
      row[name] = literal(property.initializer, file);
    }
  }
  return row;
}
const productKeys = ["slug", "name", "colorNames", "sizes", "stock", "unitCostUsd", "sourceProductId", "sourceColor"];
function product(node: ts.Expression, file: ts.SourceFile) { return fields(node, productKeys, file); }
function identifier(node: ts.Expression) {
  if (!ts.isIdentifier(node)) fail("referência local nomeada obrigatória");
  return node.text;
}
function requireImport(file: ts.SourceFile, name: string, module: string) {
  const found = file.statements.some((statement) => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === module
    && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some((element) => element.name.text === name && !element.propertyName));
  if (!found) fail(`${name}: importação local esperada ausente`);
}
function familyRows(file: ts.SourceFile, exportName: string): Row[] {
  // Restrict the supported export to the existing family/colour expansion.
  requireTransform(file, exportName);
  const normalized = assignment(file, exportName).getText(file).replace(/\s+/g, "");
  if (!normalized.startsWith("dressFamilies.flatMap((family,familyIndex)=>family.variants.map((variant,variantIndex)=>({")
    || !normalized.includes("slug:variant.slug,") || !normalized.includes("name:variant.name,")
    || !normalized.includes("colorNames:[variant.colorName],") || !normalized.includes("sizes:family.sizes,")
    || !normalized.includes("stock:variant.stock,")) fail(`${exportName}: expansão alterada`);
  return [...array(assignment(file, "dressFamilies"))].flatMap((familyNode) => {
    if (!ts.isObjectLiteralExpression(familyNode)) fail("família inválida");
    const family = fields(familyNode, ["sizes"]);
    const variants = familyNode.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(file) === "variants");
    if (!variants || !ts.isPropertyAssignment(variants)) fail("cores da família ausentes");
    return [...array(variants.initializer)].map((variantNode) => {
      const variant = fields(variantNode, ["slug", "name", "colorName", "stock"]);
      // sourceId belongs to image lineage, not exported supplier binding metadata.
      return { slug: variant.slug, name: variant.name, colorNames: [variant.colorName], sizes: family.sizes, stock: variant.stock };
    });
  });
}
function mainRows(file: ts.SourceFile, imports: Map<string, Row[]>): Row[] {
  const generated = assignment(file, "generatedProducts");
  if (ts.isArrayLiteralExpression(generated)) return [...generated.elements].map((item) => product(item, file));
  const expand = (node: ts.Expression): Row[] => [...array(node)].flatMap((item) => {
    if (!ts.isSpreadElement(item)) return [product(item, file)];
    const name = identifier(item.expression);
    const imported = imports.get(name);
    if (!imported) fail(`spread não autorizado: ${name}`);
    return imported;
  });
  const rows = expand(assignment(file, "allGeneratedProducts"));
  if (generated.getText(file).replace(/\s+/g, "") !== "allGeneratedProducts.filter((product,index)=>index<ESTABLISHED_CATALOGUE_COUNT||approvedNewProductSlugs.has(product.slug),)") fail("filtro de publicação alterado");
  const count = literal(assignment(file, "ESTABLISHED_CATALOGUE_COUNT"));
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) fail("limite de catálogo inválido");
  const approved = assignment(file, "approvedNewProductSlugs");
  if (!ts.isNewExpression(approved) || identifier(approved.expression) !== "Set" || approved.arguments?.length !== 1) fail("lista de aprovação inválida");
  const slugs = new Set([...array(approved.arguments[0])].flatMap((item) => {
    if (!ts.isSpreadElement(item)) return [literal(item)];
    const name = identifier(item.expression);
    const imported = imports.get(name.replace(/ProductSlugs$/, "Products"));
    if (!imported) fail(`lista de slugs não autorizada: ${name}`);
    return imported.map((row) => row.slug);
  }));
  return rows.filter((row, index) => index < count || slugs.has(row.slug));
}
function callRows(file: ts.SourceFile, name: string): Row[] {
  return [...array(assignment(file, name))].flatMap((element) => {
    const expression = ts.isSpreadElement(element) ? element.expression : element;
    if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) fail(`${name}: chamada não autorizada`);
    const kind = expression.expression.text;
    if (!(name === "shoeProducts" ? ["fixed", "variable"] : ["bag"]).includes(kind)) fail(`${name}: função não autorizada`);
    if ((kind === "variable") !== ts.isSpreadElement(element)) fail("spread de variante inválido");
    const args = expression.arguments;
    const values = [0, 1, 4].map((index) => literal(args[index]));
    const base = { slug: values[0], name: values[1], colorNames: [values[2]] };
    if (kind === "bag") return [{ ...base, sizes: ["One Size"], stock: literal(args[5]), unitCostUsd: literal(args[7]) }];
    if (kind === "fixed") return [{ ...base, sizes: literal(args[5], file), stock: literal(args[6]), unitCostUsd: literal(args[8]) }];
    return [...array(args[5])].map((variantNode, index) => {
      const variant = fields(variantNode, ["heelHeightCm", "sizes", "stock"], file);
      if (typeof variant.heelHeightCm !== "number") fail("altura do salto inválida");
      return { ...base,
        slug: index === 0 ? base.slug : `${base.slug}-${String(variant.heelHeightCm).replace(".", "-")}cm`,
        name: `${base.name} — ${variant.heelHeightCm} cm`, sizes: variant.sizes, stock: variant.stock, unitCostUsd: literal(args[7]),
      };
    });
  });
}
function normalize(rows: Row[]): AmbCatalogProduct[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (typeof row.slug !== "string" || !row.slug || typeof row.name !== "string" || !row.name
      || !Array.isArray(row.colorNames) || row.colorNames.length !== 1 || typeof row.colorNames[0] !== "string"
      || !Array.isArray(row.sizes) || !row.sizes.length || !row.sizes.every((size) => typeof size === "string" && size)) fail("produto incompleto");
    if (seen.has(row.slug)) fail(`slug duplicado: ${row.slug}`);
    seen.add(row.slug);
    return { slug: row.slug, name: row.name, color: row.colorNames[0], sizes: row.sizes as string[],
      stock: typeof row.stock === "number" ? row.stock : null,
      unitCostUsd: typeof row.unitCostUsd === "number" ? row.unitCostUsd : null,
      sourceProductId: typeof row.sourceProductId === "string" ? row.sourceProductId : null,
      sourceColor: typeof row.sourceColor === "string" ? row.sourceColor : null };
  });
}

export async function loadAmbRepositoryCatalog(readFile: (path: string) => Promise<RepositoryFile>) {
  const contents = await Promise.all(paths.map(async (path) => [path, await readFile(path)] as const));
  const files = new Map<string, ts.SourceFile>(contents.map(([path, value]) => [path, moduleSource(path, value.source)]));
  for (const sourceModule of files.values()) requireModuleShape(sourceModule);
  const file = (path: string) => files.get(`app/${path}.ts`)!;
  const data = file("data");
  requireTransform(data, "catalogueProducts");
  requireTransform(data, "establishedSlugs");
  for (const name of ["shell", "fixed", "variable"]) requireTransform(file("shoe-products"), name, true);
  requireTransform(file("generated-supplemental-products"), "bag", true);
  const composition = assignment(data, "products").getText(data).replace(/\s+/g, "");
  if (composition !== "[...catalogueProducts,...shoeProducts,...supplementalProducts.filter((product)=>!establishedSlugs.has(product.slug)),...octoberColorProducts,]") fail("composição app/data.ts alterada");
  for (const [name, module] of [["generatedProducts", "generated-products"], ["shoeProducts", "shoe-products"], ["supplementalProducts", "generated-supplemental-products"], ["octoberColorProducts", "october-color-products"], ["octoberSourceLineage", "october-source-lineage"]]) requireImport(data, name, `./${module}`);
  const main = file("generated-products");
  const imported = new Map<string, Row[]>();
  for (const month of ["august", "september"]) {
    const name = `${month}2026Products`;
    requireImport(main, name, `./generated-${month}-2026-products`);
    requireImport(main, `${month}2026ProductSlugs`, `./generated-${month}-2026-products`);
    const monthFile = file(`generated-${month}-2026-products`);
    if (assignment(monthFile, `${month}2026ProductSlugs`).getText(monthFile).replace(/\s+/g, "") !== `${name}.map((product)=>product.slug)`) fail(`${month}: lista de slugs alterada`);
    imported.set(name, familyRows(monthFile, name));
  }
  const established = mainRows(main, imported);
  const lineage = assignment(file("october-source-lineage"), "octoberSourceLineage");
  if (!ts.isObjectLiteralExpression(lineage)) fail("linhagem inválida");
  const bySlug = new Map(lineage.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) fail("linhagem não literal");
    return [property.name.text, fields(property.initializer, ["sourceProductId", "sourceColor"])] as const;
  }));
  const catalogue = established.map((row) => ({ ...row, ...bySlug.get(String(row.slug)) }));
  const supplemental = file("generated-supplemental-products");
  requireImport(supplemental, "workProducts", "./work-products");
  if (assignment(supplemental, "supplementalProducts").getText(supplemental).replace(/\s+/g, "") !== "[...bagProducts,...workProducts]") fail("catálogo suplementar alterado");
  const work = file("work-products");
  const supplementalRows = [...callRows(supplemental, "bagProducts"), ...array(assignment(work, "workProducts")).map((node) => product(node, work))];
  const slugs = new Set(catalogue.map((row) => row.slug));
  const october = file("october-color-products");
  const products = normalize([...catalogue, ...callRows(file("shoe-products"), "shoeProducts"),
    ...supplementalRows.filter((row) => !slugs.has(row.slug)),
    ...array(assignment(october, "octoberColorProducts")).map((node) => product(node, october))]);
  const catalogBlobSha = createHash("sha256").update(JSON.stringify(contents.map(([path, value]) => [path, value.blobSha, createHash("sha256").update(value.source).digest("hex")]))).digest("hex");
  return { products, catalogBlobSha };
}
