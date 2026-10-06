// Fails when a ternary contains another ternary (see "Code style" in AGENTS.md).
// Usage: node scripts/check-nested-ternary.mjs [files...]   (defaults to apps/*/src)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'oxc-parser';

const root = new URL('..', import.meta.url).pathname;
const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

const children = (node) =>
  Object.values(node)
    .flat()
    .filter((value) => value && typeof value === 'object' && typeof value.type === 'string');

/** A function inside a branch starts its own scope, so its ternaries don't count as nested. */
function containsTernary(node) {
  if (node.type === 'ConditionalExpression') return true;
  if (FUNCTION_TYPES.has(node.type)) return false;
  return children(node).some(containsTernary);
}

function findNested(node, found = []) {
  if (node.type === 'ConditionalExpression' && [node.test, node.consequent, node.alternate].some(containsTernary)) {
    found.push(node);
  }
  for (const child of children(node)) findNested(child, found);
  return found;
}

const appsDir = join(root, 'apps');
const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(appsDir).flatMap((app) => {
        try {
          return sourceFiles(join(appsDir, app, 'src'));
        } catch {
          return [];
        }
      });

let problems = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const { program, errors } = parseSync(file, source);
  if (errors.length > 0) {
    console.error(`${relative(root, file)}: could not parse (${errors[0].message})`);
    problems++;
    continue;
  }
  for (const node of findNested(program)) {
    const line = source.slice(0, node.start).split('\n').length;
    const snippet = source.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 100);
    console.error(`${relative(root, file)}:${line}: nested ternary: ${snippet}`);
    problems++;
  }
}

if (problems > 0) {
  console.error(`\n${problems} problem(s). Rewrite nested ternaries as described under "Code style" in AGENTS.md.`);
  process.exit(1);
}
console.log(`No nested ternaries in ${files.length} files.`);
