// Bundles app.html and src/ into one self-contained page at dist/index.html: the form that is published as a
// Claude artifact. Three.js stays external and loads from jsDelivr through the import map.
// Usage: npm run build
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
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
let html = await readFile(join(ROOT, 'app.html'), 'utf8');

for (const tag of [CSS_TAG, JS_TAG]) {
  if (!html.includes(tag)) throw new Error(`app.html no longer contains ${tag}; update scripts/build.mjs`);
}
html = html
  .replace(CSS_TAG, () => `<style>\n${css}</style>`)
  .replace(JS_TAG, () => `<script type="module">\n${js}</script>`);

await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(join(ROOT, 'dist/index.html'), html);
console.log(`dist/index.html written (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);

// Separate geographic explorer; retains the original builder at dist/index.html.
const atlasBundle = await build({ entryPoints: [join(ROOT, 'src/thane/main.js')], bundle: true, format: 'esm', target: 'es2020', external: ['three', 'three/addons/*'], write: false });
const atlasCSS = await readFile(join(ROOT, 'src/thane/style.css'), 'utf8');
let atlasHTML = await readFile(join(ROOT, 'thane.html'), 'utf8');
atlasHTML = atlasHTML.replace('<link rel="stylesheet" href="src/thane/style.css">', () => `<style>${atlasCSS}</style>`)
  .replace('<script type="module" src="src/thane/main.js"></script>', () => `<script type="module">${atlasBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replaceAll('node_modules/maplibre-gl/dist/', 'vendor/')
  .replaceAll('href="app.html"', 'href="index.html"');
await mkdir(join(ROOT, 'dist/vendor'), { recursive: true });
for (const file of ['maplibre-gl.js', 'maplibre-gl.css']) await copyFile(join(ROOT, 'node_modules/maplibre-gl/dist', file), join(ROOT, 'dist/vendor', file));
await copyFile(join(ROOT, 'node_modules/maplibre-gl/LICENSE.txt'), join(ROOT, 'dist/vendor/maplibre-LICENSE.txt'));
await writeFile(join(ROOT, 'dist/thane.html'), atlasHTML);
console.log('dist/thane.html written with map renderer assets');
