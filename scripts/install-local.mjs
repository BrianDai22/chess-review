import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const run=(command,args)=>{const r=spawnSync(command,args,{stdio:'inherit'});if(r.status!==0)throw new Error(`Command failed: ${command}`);};
run(process.execPath,['scripts/setup-engine.mjs']);run(process.execPath,['scripts/build.mjs']);
const root=join(homedir(),'plugins','chess-review'),marketplacePath=join(homedir(),'.agents','plugins','marketplace.json');
let marketplace;try{marketplace=JSON.parse(await readFile(marketplacePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;marketplace={name:'personal',interface:{displayName:'Personal'},plugins:[]};}
if(marketplace.name!=='personal' || !Array.isArray(marketplace.plugins))throw new Error('Existing personal marketplace format differs; preserve it and use the documented authoring helper.');
const entry=marketplace.plugins.find(p=>p.name==='chess-review');
if(entry && (entry.source?.source!=='local' || entry.source?.path!=='./plugins/chess-review'))throw new Error('Existing Chess Review marketplace source differs. Preserve it and resolve the source path before installing.');
const manifest=JSON.parse(await readFile('chess-review/.codex-plugin/plugin.json','utf8'));
manifest.version=manifest.version.split('+')[0]+'+codex.'+Date.now();
await mkdir(root,{recursive:true});await cp('chess-review',root,{recursive:true});
await writeFile(join(root,'.codex-plugin','plugin.json'),JSON.stringify(manifest,null,2)+'\n');
const portable=JSON.parse(await readFile(join(root,'plugin.json'),'utf8'));portable.version=manifest.version;await writeFile(join(root,'plugin.json'),JSON.stringify(portable,null,2)+'\n');
if(!entry){marketplace.plugins.push({name:'chess-review',source:{source:'local',path:'./plugins/chess-review'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'});await mkdir(join(homedir(),'.agents','plugins'),{recursive:true});await writeFile(marketplacePath,JSON.stringify(marketplace,null,2)+'\n');}
const cli=process.env.CHESS_REVIEW_CODEX_CLI || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
run(cli,['plugin','add','chess-review@personal']);
console.log('Open Chess Review from Plugins. Existing chats created before installation may need to be reopened before they can load its tools.');
