import ts from "typescript";
const forbidden = new Set([
  "Date",
  "performance",
  "fetch",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "globalThis",
  "eval",
  "Function",
  "WeakRef",
  "FinalizationRegistry",
  "Worker",
  "WebSocket",
  "XMLHttpRequest",
  "process",
  "require",
  "window",
  "document",
  "self",
  "console",
  "Atomics",
  "SharedArrayBuffer",
]);
export function compileBot(source) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > 262144
  )
    throw new Error("The controller must be a JS/TS file no larger than 256 KB.");
  const tree = ts.createSourceFile(
    "bot.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  if (tree.parseDiagnostics.length)
    throw new Error(
      ts.flattenDiagnosticMessageText(
        tree.parseDiagnostics[0].messageText,
        " ",
      ),
    );
  let exports = [];
  for (const n of tree.statements) {
    if (
      ts.isImportDeclaration(n) ||
      ts.isImportEqualsDeclaration(n) ||
      ts.isExportDeclaration(n) ||
      ts.isExportAssignment(n)
    )
      throw new Error("Only one tick export and no imports are allowed.");
    if (n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
      throw new Error("Use export function tick, not export default.");
    if (n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(n)) exports.push(n.name?.text);
      else if (ts.isVariableStatement(n))
        exports.push(...n.declarationList.declarations.map((d) => d.name.text));
      else throw new Error("The only allowed export is tick.");
    }
  }
  if (exports.length !== 1 || exports[0] !== "tick")
    throw new Error("The module must export only tick.");
  function scan(n) {
    const propertyName =
      n.parent &&
      ((ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) ||
        (ts.isPropertyAssignment(n.parent) && n.parent.name === n));
    if (ts.isIdentifier(n) && !propertyName && forbidden.has(n.text))
      throw new Error("Forbidden global: " + n.text);
    if (n.kind === ts.SyntaxKind.ImportKeyword)
      throw new Error("Dynamic imports are forbidden.");
    if (
      (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) &&
      n.expression.getText(tree) === "Math"
    ) {
      const key = ts.isPropertyAccessExpression(n)
        ? n.name.text
        : ts.isStringLiteral(n.argumentExpression)
          ? n.argumentExpression.text
          : null;
      if (key === "random") throw new Error("Math.random is forbidden.");
    }
    ts.forEachChild(n, scan);
  }
  scan(tree);
  const plain = ts.factory.updateSourceFile(
    tree,
    tree.statements.map((n) =>
      n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ? ts.factory.replaceModifiers(
            n,
            n.modifiers.filter((m) => m.kind !== ts.SyntaxKind.ExportKeyword),
          )
        : n,
    ),
  );
  const result = ts.transpileModule(ts.createPrinter().printFile(plain), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      isolatedModules: true,
    },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (errors?.length)
    throw new Error(
      ts.flattenDiagnosticMessageText(errors[0].messageText, " "),
    );
  return result.outputText;
}
