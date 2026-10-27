import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
function isolateGit() { const saved=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith('GIT_'))); for(const key of Object.keys(process.env))if(key.startsWith('GIT_'))delete process.env[key];process.env.GIT_CONFIG_GLOBAL='/dev/null';process.env.GIT_CONFIG_NOSYSTEM='1';process.env.GIT_TERMINAL_PROMPT='0';return ()=>{for(const key of Object.keys(process.env))if(key.startsWith('GIT_'))delete process.env[key];Object.assign(process.env,saved)};}
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import extension from '../../src/adapters/pi/index.ts';

test('pi retries a transient Git startup failure and keeps non-repositories silent', {skip:process.platform==='win32',timeout:20000},async (t)=>{
  const base=await mkdtemp(join(tmpdir(),'gitrelay-pi-startup-regression-'));
  const originalPath=process.env.PATH,originalState=process.env.WORKTREE_SYNC_STATE_DIR,originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
  const restoreGit=isolateGit();
  const timers=new Set<{fn:()=>void;unref:()=>void}>();
  globalThis.setInterval=((fn:()=>void,ms:number)=>{assert.equal(ms,5000);const timer={fn,unref(){}};timers.add(timer);return timer}) as unknown as typeof setInterval;
  globalThis.clearInterval=((timer:unknown)=>{timers.delete(timer as {fn:()=>void;unref:()=>void})}) as typeof clearInterval;
  const shutdowns: Array<()=>Promise<void>> = [];
  t.after(async()=>{await Promise.allSettled(shutdowns.map((stop)=>stop()));globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear;if(originalPath===undefined)delete process.env.PATH;else process.env.PATH=originalPath;if(originalState===undefined)delete process.env.WORKTREE_SYNC_STATE_DIR;else process.env.WORKTREE_SYNC_STATE_DIR=originalState;restoreGit();if(!process.env.GITRELAY_KEEP_TEST_FIXTURES)await rm(base,{recursive:true,force:true})});
  const template=join(base,'template'),bin=join(base,'bin');await mkdir(template);await mkdir(bin);
  function git(...args:string[]){execFileSync('/usr/bin/git',args,{stdio:'pipe'})}
  function init(repo:string){git('init','--template',template,'-b','main',repo);git('-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','initial')}
  const repo=join(base,'repo'),flag=join(base,'ready'),log=join(base,'calls');init(repo);
  const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
  const executable=join(bin,'git');await writeFile(executable,`#!/bin/sh\nprintf x >> ${quote(log)}\nif [ ! -f ${quote(flag)} ]; then : > ${quote(flag)}; echo 'transient Git failure' >&2; exit 75; fi\nexec /usr/bin/git "$@"\n`);await chmod(executable,0o755);
  const build=(cwd:string,id:string,enabled=true)=>{const handlers:Record<string,(event:unknown,ctx:any)=>Promise<void>>={},notices:string[]=[];let command:any;
    extension({registerFlag(){},registerCommand(_name:string,value:unknown){command=value},getFlag(name:string){return name==='worktree-watch'?enabled:'refs/heads/main'},on(name:string,cb:(event:unknown,ctx:any)=>Promise<void>){handlers[name]=cb},sendMessage(){throw Error('unexpected delivery')}} as unknown as ExtensionAPI);
    const ctx={mode:'tui',hasUI:true,cwd,sessionManager:{getSessionId:()=>id,getHeader:()=>({id:id,timestamp:'2026-01-01T00:00:00.000Z'}),getSessionFile:()=>undefined,getBranch:()=>[],getEntries:()=>[],getLeafId:()=>null},isIdle:()=>true,hasPendingMessages:()=>false,ui:{notify(value:string){notices.push(value)}}};shutdowns.push(()=>handlers.session_shutdown({},ctx));return{handlers,notices,ctx,command};};
  async function count(state:string){let total=0;const dirs=await readdir(join(state,'repos')).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error});for(const dir of dirs)if(/^[a-f0-9]{64}$/.test(dir))total+=(await readdir(join(state,'repos',dir,'sessions')).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error})).filter(x=>x.endsWith('.json')).length;return total}
  async function eventually(check:()=>Promise<boolean>){for(let i=0;i<250;i++){if(await check())return;await delay(20)}throw Error('Timed out waiting for watcher')}
  process.env.PATH=`${bin}:/usr/bin:/bin`;process.env.WORKTREE_SYNC_STATE_DIR=join(base,'state1');
  const first=build(repo,'receiver');await first.handlers.session_start({},first.ctx);assert.match(first.notices[0],/transient Git failure/);assert.equal(timers.size,1);
  [...timers][0].fn();await eventually(async()=>await count(join(base,'state1'))===1);await first.handlers.session_shutdown({},first.ctx);assert.equal(timers.size,0);
  const outside=join(base,'outside'),log2=join(base,'calls2');await mkdir(outside);await writeFile(executable,`#!/bin/sh\nprintf x >> ${quote(log2)}\nexec /usr/bin/git "$@"\n`);process.env.WORKTREE_SYNC_STATE_DIR=join(base,'state2');
  const second=build(outside,'later');await second.handlers.session_start({},second.ctx);assert.deepEqual(second.notices,[]);assert.equal(timers.size,1);
  for(let i=0;i<3;i++)await eventually(async()=>{[...timers][0].fn();return (await readFile(log2,'utf8')).length>=i+2});
  assert.deepEqual(second.notices,[]);assert.ok((await readFile(log2,'utf8')).length>=4);init(outside);await eventually(async()=>{[...timers][0].fn();return await count(join(base,'state2'))===1});await second.handlers.session_shutdown({},second.ctx);assert.equal(timers.size,0);
  const disabled=build(repo,'disabled',false);await disabled.handlers.session_start({},disabled.ctx);assert.equal(timers.size,0);await disabled.handlers.session_shutdown({},disabled.ctx);
});

test('shutdown waits for a prior watcher stop during overlapping starts', {skip:process.platform==='win32',timeout:10000},async (t)=>{
  const fs=await import('node:fs'), {syncBuiltinESMExports}=await import('node:module');
  const base=await mkdtemp(join(tmpdir(),'gitrelay-pi-startup-stop-')),repo=join(base,'repo'),template=join(base,'template'),sessionFile=join(base,'blocked-session.jsonl');
  const originalStat=fs.default.promises.stat,originalState=process.env.WORKTREE_SYNC_STATE_DIR,restoreGit=isolateGit();
  const started=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  const handlers:Record<string,(event:unknown,ctx:any)=>Promise<void>>={};
  const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'blocked',getHeader:()=>({id: 'blocked',timestamp:'2026-01-01T00:00:00.000Z'}),getSessionFile:()=>sessionFile,getBranch:()=>[],getEntries:()=>[],getLeafId:()=>null},isIdle:()=>true,hasPendingMessages:()=>false,ui:{notify(){}}};
  t.after(async()=>{release.resolve();try{await handlers.session_shutdown?.({},ctx)}finally{fs.default.promises.stat=originalStat;syncBuiltinESMExports();if(originalState===undefined)delete process.env.WORKTREE_SYNC_STATE_DIR;else process.env.WORKTREE_SYNC_STATE_DIR=originalState;restoreGit();if(!process.env.GITRELAY_KEEP_TEST_FIXTURES)await rm(base,{recursive:true,force:true})}});
  await mkdir(template);execFileSync('/usr/bin/git',['init','--template',template,'-b','main',repo],{stdio:'ignore'});
  execFileSync('/usr/bin/git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','initial'],{stdio:'ignore'});
  fs.default.promises.stat=(async (path:unknown,...args:unknown[])=>{if(path===sessionFile){started.resolve();await release.promise;throw Object.assign(new Error('synthetic absent session'),{code:'ENOENT'})}return (originalStat as (...args:any[])=>Promise<any>)(path,...args)}) as typeof fs.default.promises.stat;
  syncBuiltinESMExports();process.env.WORKTREE_SYNC_STATE_DIR=join(base,'state');
  extension({registerFlag(){},registerCommand(){},getFlag(name:string){return name==='worktree-watch'?true:'refs/heads/main'},on(name:string,cb:(event:unknown,ctx:any)=>Promise<void>){handlers[name]=cb},sendMessage(){throw Error('unexpected delivery')}} as unknown as ExtensionAPI);
  const first=handlers.session_start({},ctx);await started.promise;
  const second=handlers.session_start({},ctx);let stopped=false;const stop=handlers.session_shutdown({},ctx).then(()=>{stopped=true});
  await delay(50);assert.equal(stopped,false,'shutdown must await the old watcher while it is still stopping');
  release.resolve();await Promise.all([first,second,stop]);assert.equal(stopped,true);
});
