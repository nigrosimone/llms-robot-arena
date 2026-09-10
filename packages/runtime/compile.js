// A controller is one JavaScript file. Parsing it is the whole static gate:
// the source is read, never executed, and what comes out is the same text with
// the export keyword removed, so a runtime error still points at the line the
// author wrote.
import { parse } from "acorn";
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
const isNode = (value) =>
  value && typeof value === "object" && typeof value.type === "string";
// `o.document` names a property of someone else's object; `document` alone is
// the host global the sandbox refuses to expose.
const isPropertyName = (node, parent) =>
  !!parent &&
  !parent.computed &&
  ((parent.type === "MemberExpression" && parent.property === node) ||
    (["Property", "PropertyDefinition", "MethodDefinition"].includes(parent.type) &&
      parent.key === node));

function scan(node, parent) {
  if (node.type === "ImportExpression")
    throw new Error("Dynamic imports are forbidden.");
  if (
    node.type === "Identifier" &&
    !isPropertyName(node, parent) &&
    forbidden.has(node.name)
  )
    throw new Error("Forbidden global: " + node.name);
  if (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "Math"
  ) {
    const key = node.computed
      ? node.property.type === "Literal"
        ? node.property.value
        : null
      : node.property.name;
    if (key === "random") throw new Error("Math.random is forbidden.");
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) scan(child, node);
    } else if (isNode(value)) scan(value, node);
  }
}

export function compileBot(source) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > 262144
  )
    throw new Error("The controller must be a JS file no larger than 256 KB.");
  let tree;
  try {
    tree = parse(source, { ecmaVersion: 2022, sourceType: "module" });
  } catch (e) {
    throw new Error(e.message);
  }
  const exports = [];
  const keywords = [];
  for (const node of tree.body) {
    if (node.type === "ExportDefaultDeclaration")
      throw new Error("Use export function tick, not export default.");
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" && !node.declaration)
    )
      throw new Error("Only one tick export and no imports are allowed.");
    if (node.type !== "ExportNamedDeclaration") continue;
    const declaration = node.declaration;
    if (declaration.type === "FunctionDeclaration") exports.push(declaration.id?.name);
    else if (declaration.type === "VariableDeclaration")
      for (const declared of declaration.declarations)
        exports.push(declared.id.type === "Identifier" ? declared.id.name : null);
    else throw new Error("The only allowed export is tick.");
    keywords.push([node.start, declaration.start]);
  }
  if (exports.length !== 1 || exports[0] !== "tick")
    throw new Error("The module must export only tick.");
  scan(tree, null);
  let plain = source;
  for (const [from, to] of keywords.reverse())
    plain = plain.slice(0, from) + plain.slice(to);
  return plain;
}
