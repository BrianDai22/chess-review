import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

test('running compiled server keeps its immutable UI resource after plugin cache deletion', {timeout:10000}, async t => {
  const temporary = await mkdtemp(join(tmpdir(),'chess-review-cache-lifetime-'));
  const cache = join(temporary,'version-cache'), serverPath = join(cache,'server','index.mjs');
  let client;
  t.after(async () => { if(client)await client.close();await rm(temporary,{recursive:true,force:true}); });
  await mkdir(join(cache,'server'),{recursive:true});await mkdir(join(cache,'assets'));
  await cp(new URL('../chess-review/assets/pawn.svg',import.meta.url),join(cache,'assets','pawn.svg'));
  const html = '<!doctype html><html><body><main>Immutable review resource</main></body></html>';
  await writeFile(join(cache,'ui.html'),html);
  await build({entryPoints:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],outfile:serverPath,
    platform:'node',format:'esm',bundle:true,target:'node24',
    banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'}});
  const transport = new StdioClientTransport({command:process.execPath,args:[serverPath],stderr:'pipe',
    env:{...getDefaultEnvironment(),CHESS_REVIEW_DATA_DIR:join(temporary,'data')}});
  client = new Client({name:'cache-lifetime-regression',version:'0.1.0'},{capabilities:{}});
  await client.connect(transport);
  const tools = await client.listTools();
  const uri = tools.tools.find(tool => tool.name === 'open_review')._meta.ui.resourceUri;
  assert.match(uri, /^ui:\/\/chess-review\/review-[a-f0-9]{16}\.html$/);
  const request = {uri};
  const before = await client.readResource(request);
  assert.equal(before.contents[0].text,html);
  assert.equal((await client.readResource({uri:'ui://chess-review/review'})).contents[0].text,html);
  // A plugin update unlinks the old version while its MCP process is alive.
  await rm(cache,{recursive:true,force:true});
  const after = await client.readResource(request);
  assert.deepEqual(after,before);
  assert.equal((await client.readResource({uri:'ui://chess-review/review'})).contents[0].text,html);
  const catalog = await client.callTool({name:'list_games',arguments:{}});
  assert.notEqual(catalog.isError,true);
  assert.ok(catalog.structuredContent.games.some(game=>game.fixture));
});
