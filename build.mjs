// Build: inline parser.mjs + the page script from src/index.html into a single
// classic <script>, hash it, and write dist/index.html with the CSP as a
// <meta http-equiv> pinned to that hash. No dependencies.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const SCRIPT_RE = /<script type="module">\n([\s\S]*?)<\/script>/;
const IMPORT_RE = /^import \{[^}]*\} from '\.\.\/parser\.mjs';\n/m;
const CHARSET_META = '<meta charset="utf-8">\n';

export function cspContent(hash) {
  // style-src isn't hashed: only a static <style> block, no HTML sinks, default-src 'none'; kept simple.
  return (
    `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; ` +
    `img-src data:; base-uri 'none'; form-action 'none'`
  );
}

function stripExports(source) {
  const out = source.replace(/^export (const|function) /gm, '$1 ');
  if (/^\s*(export|import)\b/m.test(out)) {
    throw new Error('parser.mjs: unsupported import/export form');
  }
  return out;
}

export function buildPage(template, parserSource) {
  const count = (re) => (template.match(re) || []).length;
  if (count(/<script/gi) !== 1 || count(/<\/script/gi) !== 1) {
    throw new Error('src/index.html must contain exactly one <script> and one </script>');
  }
  if (template.split(CHARSET_META).length !== 2) {
    throw new Error('src/index.html must contain exactly one <meta charset="utf-8">');
  }
  const m = SCRIPT_RE.exec(template);
  if (!m) throw new Error('src/index.html: <script type="module"> block not found');
  const pageSource = m[1];
  if (!IMPORT_RE.test(pageSource)) throw new Error('page script must import from ../parser.mjs');
  const pageBody = pageSource.replace(IMPORT_RE, '');
  if (/^\s*(export|import)\b/m.test(pageBody)) {
    throw new Error('page script: unexpected import/export');
  }

  const script =
    "\n(() => {\n'use strict';\n\n// ---- parser.mjs ----\n" +
    stripExports(parserSource) +
    '\n// ---- page ----\n' +
    pageBody +
    '})();\n';

  if (/<\/script|<!--/i.test(script)) throw new Error('inlined script contains </script or <!--');

  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  // Function replacements so `$` sequences are taken literally.
  const html = template
    .replace(SCRIPT_RE, () => `<script>${script}</script>`)
    .replace(
      CHARSET_META,
      () => `${CHARSET_META}<meta http-equiv="Content-Security-Policy" content="${cspContent(hash)}">\n`,
    );
  return { html, script, hash };
}

export function build(outDir = join(ROOT, 'dist')) {
  const template = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
  const parserSource = readFileSync(join(ROOT, 'parser.mjs'), 'utf8');
  const { html, hash } = buildPage(template, parserSource);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  return { outDir, hash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { outDir, hash } = build();
  console.log(`built ${outDir}/index.html (script sha256-${hash})`);
}
