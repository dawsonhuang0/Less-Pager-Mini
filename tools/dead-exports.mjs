#!/usr/bin/env node
/**
 * Exported symbols with no use site anywhere in the project.
 *
 * No linter here answers this: eslint has no import plugin and there is
 * no ts-prune. tsconfig's `noUnusedLocals` catches unused LOCALS, which
 * is why nothing dead survives inside a function - but an unused export
 * is invisible to it, because exporting counts as using.
 *
 * So ask the compiler directly. Build the real program, walk every
 * identifier in it, resolve each one to its symbol (through import
 * aliases), and count the ones that land on an exported declaration.
 * An export whose only occurrence is its own name is dead.
 *
 * Resolving rather than grepping matters: a grep counts the symbol's
 * name in comments, in strings, and on unrelated locals that happen to
 * share it, and undercounts anything reached through a renaming import.
 *
 *     node tools/dead-exports.mjs            # report, exit 1 if any
 *     node tools/dead-exports.mjs --json
 */
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function loadProgram() {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('no tsconfig.json');

  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);

  // tsconfig.json includes "src" alone, so a program built from it
  // cannot see the tests - and an export only the tests use would be
  // reported dead. They are use sites like any other, so they go in
  // .mjs and .js too, not just .ts: tests/fixtures/guardProbe.mjs
  // imports straight from dist/, and scanning only TypeScript declared
  // three guard exports dead that it was the sole caller of
  const tests = [];
  const walk = dir => {
    for (const e of ts.sys.readDirectory(dir, ['.ts', '.mjs', '.js', '.cjs'])) {
      tests.push(e);
    }
  };
  if (ts.sys.directoryExists(path.join(ROOT, 'tests'))) {
    walk(path.join(ROOT, 'tests'));
  }

  return ts.createProgram([...parsed.fileNames, ...tests], {
    ...parsed.options,
    noEmit: true,
    // the tests import vitest and friends; missing types must not stop
    // the walk, and no diagnostics are read here anyway
    noUnusedLocals: false,
    noUnusedParameters: false,
    // the .mjs fixtures import from dist/, and are plain JS
    allowJs: true,
    checkJs: false,
  });
}

/** The name node of an exported top-level declaration, or null. */
function exportedName(node) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  const exported = mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) return null;

  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) {
    return node.name ? [node.name] : null;
  }

  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .map(d => d.name)
      .filter(ts.isIdentifier);
  }

  return null;
}

const program = loadProgram();
const checker = program.getTypeChecker();
const inSrc = f => f.fileName.startsWith(SRC + path.sep) && !f.isDeclarationFile;

/** symbol -> { name, file, line, uses } */
const declared = new Map();
const declNodes = new Set();

for (const file of program.getSourceFiles()) {
  if (!inSrc(file)) continue;

  for (const stmt of file.statements) {
    for (const name of exportedName(stmt) ?? []) {
      const sym = checker.getSymbolAtLocation(name);
      if (!sym) continue;

      declNodes.add(name);
      const { line } = file.getLineAndCharacterOfPosition(name.getStart());
      declared.set(sym, {
        name: name.text,
        file: path.relative(ROOT, file.fileName),
        line: line + 1,
        uses: 0,
      });
    }
  }
}

/**
 * Naming a symbol to move it between modules is not USING it.
 *
 * `import { x }` and `export { x }` mention x without doing anything
 * with it, so counting them makes every exported symbol look used the
 * moment one file imports it - which is exactly what a dead export
 * looks like. Caught by self-test: commenting out the one call to
 * endJsRegexGuard left the import behind, and the tool went on calling
 * it live.
 */
function isPlumbing(id) {
  const p = id.parent;

  return ts.isImportSpecifier(p) || ts.isImportClause(p) ||
    ts.isNamespaceImport(p) || ts.isExportSpecifier(p) ||
    ts.isImportEqualsDeclaration(p);
}

/** Follow import aliases to the thing actually declared. */
function resolve(sym) {
  return sym && (sym.flags & ts.SymbolFlags.Alias)
    ? checker.getAliasedSymbol(sym)
    : sym;
}

// every identifier in the WHOLE program, tests and entry points included
for (const file of program.getSourceFiles()) {
  if (file.isDeclarationFile) continue;

  const visit = node => {
    if (ts.isIdentifier(node) && !declNodes.has(node) && !isPlumbing(node)) {
      const hit = declared.get(resolve(checker.getSymbolAtLocation(node)));
      if (hit) hit.uses++;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
}

const dead = [...declared.values()]
  .filter(d => d.uses === 0)
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(dead, null, 2));
} else {
  console.log(`${declared.size} exported symbols across ${program.getSourceFiles().filter(inSrc).length} files in src/`);
  console.log(`${dead.length} with no use site anywhere:\n`);
  for (const d of dead) {
    console.log(`  ${d.name.padEnd(26)} ${d.file}:${d.line}`);
  }
}

process.exit(dead.length ? 1 : 0);
