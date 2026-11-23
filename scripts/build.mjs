// Bundles src/ into one self-contained page at dist/index.html: the form that is published as a
// Claude artifact. Three.js stays external and loads from jsDelivr through the import map.
// Usage: npm run build
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CSS_TAG = '<link rel="stylesheet" href="src/styles.css">';
const JS_TAG = '<script type="module" src="src/main.js"></script>';

const result = await build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  external: ['three', 'three/addons/*'],
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(join(ROOT, 'src/styles.css'), 'utf8');
let html = await readFile(join(ROOT, 'index.html'), 'utf8');

for (const tag of [CSS_TAG, JS_TAG]) {
  if (!html.includes(tag)) throw new Error(`index.html no longer contains ${tag}; update scripts/build.mjs`);
}
html = html
  .replace(CSS_TAG, () => `<style>\n${css}</style>`)
  .replace(JS_TAG, () => `<script type="module">\n${js}</script>`);

await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(join(ROOT, 'dist/index.html'), html);
console.log(`dist/index.html written (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
