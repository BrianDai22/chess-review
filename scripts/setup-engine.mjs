import {mkdtemp,writeFile,cp,mkdir,rm,access,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Engine,ENGINE_PROFILE} from '../src/engine.mjs';
import {defaultDataDir} from '../src/store.mjs';
const destination=join(defaultDataDir(),'engine','stockfish');
const binary=join(destination,'stockfish-macos-universal');
try { await access(binary); await new Engine({binary}).identity(); console.log('Pinned Stockfish is already installed.'); }
catch(error) {
 if(error.code!=='ENOENT') throw error;
 const temp=await mkdtemp(join(tmpdir(),'chess-review-engine-'));
 try {
  let source=join(process.cwd(),'.runtime','stockfish','stockfish');
  try { await access(join(source,'stockfish-macos-universal')); }
  catch {
   const url='https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-macos-universal.tar.gz';
   const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Official engine download failed (${response.status})`);
   const archive=join(temp,'stockfish.tar.gz');await writeFile(archive,new Uint8Array(await response.arrayBuffer()));
   const unpack=spawnSync('tar',['-xzf',archive,'-C',temp],{encoding:'utf8'});if(unpack.status!==0)throw new Error(unpack.stderr || 'Engine archive extraction failed');source=join(temp,'stockfish');
  }
  await new Engine({binary:join(source,'stockfish-macos-universal')}).identity();
  await access(join(source,'Copying.txt'));await access(join(source,'src'));
  const engineRoot=join(defaultDataDir(),'engine');await mkdir(engineRoot,{recursive:true});
  const staging=await mkdtemp(join(engineRoot,'.stockfish-staging-'));
  try {
   const staged=join(staging,'stockfish');await cp(source,staged,{recursive:true});
   await new Engine({binary:join(staged,'stockfish-macos-universal')}).identity();
   await writeFile(join(staged,'chess-review-profile.json'),JSON.stringify(ENGINE_PROFILE,null,2)+'\n');
   try {await access(destination);await rename(destination,`${destination}.incomplete.${Date.now()}`);}catch(error){if(error.code!=='ENOENT')throw error;}
   await rename(staged,destination);
  } finally {await rm(staging,{recursive:true,force:true});}
  console.log('Installed pinned Stockfish with corresponding source and license outside the plugin cache.');
 } finally { await rm(temp,{recursive:true,force:true}); }
}
