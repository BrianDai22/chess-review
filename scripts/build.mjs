import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
await mkdir('chess-review/server', { recursive: true });
await build({ entryPoints: ['src/server.mjs'], outfile: 'chess-review/server/index.mjs', platform: 'node', format: 'esm', bundle: true, target: 'node24', banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
const ui = await build({ entryPoints: ['src/ui.mjs'], bundle: true, write: false, format: 'esm', target: 'es2022', loader: { '.css': 'empty' } });
const css = (await Promise.all([
  'node_modules/@openai/mcp-extensions/styles.css',
  'node_modules/@lichess-org/chessground/assets/chessground.base.css',
  'node_modules/@lichess-org/chessground/assets/chessground.cburnett.css',
  'src/ui.css'
].map(path => readFile(path, 'utf8')))).join('\n');
await writeFile('chess-review/ui.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main id="app">Connecting review…</main><script type="module">${ui.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
await mkdir('chess-review/source', {recursive:true});
for (const name of ['src','scripts','docs','tests','package.json','package-lock.json','README.md','LICENSE']) await cp(name, `chess-review/source/${name}`, {recursive:true});
for (const name of ['plugin.json','mcp.json','.codex-plugin','.mcp.json','assets','skills']) await cp(`chess-review/${name}`, `chess-review/source/chess-review/${name}`, {recursive:true});
await cp('LICENSE','chess-review/LICENSE');
await cp('docs/third-party-notices.md','chess-review/THIRD-PARTY-NOTICES.md');
await cp('docs/licenses','chess-review/licenses',{recursive:true});
