import ts from "typescript";

// Static measurements of a controller's source. They describe the submitted
// implementation, not its quality, and never run the code.
const BRANCHES = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);
const OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);
const FUNCTIONS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);
const NESTING = new Set([
  ...FUNCTIONS,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
]);

// A line counts as a comment line when everything on it is comment text, so a
// trailing note after code still counts as code.
function commentCoverage(source, lines) {
  // Line offsets are read from the source, so CRLF files do not drift.
  const starts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n" || source[i] === "\r") {
      if (source[i] === "\r" && source[i + 1] === "\n") i++;
      starts.push(i + 1);
    }
  const bare = (text) => text.replace(/\s/g, "").length;
  const covered = lines.map(() => 0);
  const withComment = new Set();
  const scanner = ts.createScanner(
    ts.ScriptTarget.ES2022, false, ts.LanguageVariant.Standard, source,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const start = scanner.getTokenStart(), end = scanner.getTokenEnd();
    for (let line = 0; line < lines.length; line++) {
      const first = Math.max(start, starts[line]),
        last = Math.min(end, starts[line] + lines[line].length);
      if (first >= last) continue;
      withComment.add(line);
      covered[line] += bare(source.slice(first, last));
    }
  }
  const commentOnly = lines.filter(
    (line, i) => withComment.has(i) && covered[i] === bare(line),
  ).length;
  return { commentLines: withComment.size, commentOnly };
}

export function codeMetrics(source, file = "bot.js") {
  if (typeof source !== "string" || !source.trim()) return null;
  const typescript = file.endsWith(".ts");
  const tree = ts.createSourceFile(
    file, source, ts.ScriptTarget.ES2022, true,
    typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  let complexity = 1, functions = 0, statements = 0, maxDepth = 0;
  const walk = (node, depth) => {
    if (BRANCHES.has(node.kind)) complexity++;
    if (ts.isBinaryExpression(node) && OPERATORS.has(node.operatorToken.kind)) complexity++;
    if (FUNCTIONS.has(node.kind)) functions++;
    if (ts.isStatement(node)) statements++;
    const next = NESTING.has(node.kind) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, next);
    ts.forEachChild(node, (child) => walk(child, next));
  };
  ts.forEachChild(tree, (node) => walk(node, 0));
  const lines = source.split(/\r\n|\r|\n/);
  const { commentLines, commentOnly } = commentCoverage(source, lines);
  const blank = lines.filter((line) => !line.trim()).length;
  return {
    language: typescript ? "ts" : "js",
    bytes: new TextEncoder().encode(source).length,
    lines: lines.length,
    codeLines: lines.length - blank - commentOnly,
    commentLines,
    blankLines: blank,
    functions,
    statements,
    complexity,
    maxDepth,
  };
}
