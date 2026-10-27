import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import extension from '../../src/adapters/pi/index.ts';

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'gitrelay-pi-dialog-test-'));
  let finish = async () => {};
  const previousGit = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')));
  const previous = Object.fromEntries(['PATH', 'WORKTREE_SYNC_STATE_DIR'].map((key) => [key, process.env[key]]));
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
  t.after(async () => {
    try { await finish(); }
    finally {
      for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
      Object.assign(process.env, previousGit);
      for (const [key, value] of Object.entries(previous)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
      if (!process.env.GITRELAY_KEEP_TEST_FIXTURES) await rm(base, { recursive: true, force: true });
    }
  });
  const repo=join(base,'repo'), template=join(base,'template'), bin=join(base,'bin'), state=join(base,'state');
  let gitPath: string | undefined;
  for (const entry of (process.env.PATH ?? '/usr/bin:/bin').split(delimiter)) {
    const candidate = resolve(entry || '.', 'git');
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) { gitPath = candidate; break; } } catch {}
  }
  if (!gitPath) throw new Error('Git executable was not found on PATH');
  await mkdir(template);await mkdir(bin);
  execFileSync(gitPath,['init','--template',template,'-b','main',repo],{stdio:'ignore'});
  execFileSync(gitPath,['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--allow-empty','-m','initial'],{stdio:'ignore'});
  process.env.PATH=`${bin}:/usr/bin:/bin`;process.env.WORKTREE_SYNC_STATE_DIR=state;
  return {base,repo,bin,state,gitPath,setFinish(fn: () => Promise<void>){finish=fn}};
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function host(repo: string) {
  const handlers: Record<string,(event?: any,ctx?: any)=>Promise<void>>={},commands: Record<string,any>={},notices: unknown[][]=[];
  let session='old', selection: Promise<string> = Promise.resolve('');
  const pi={registerFlag(){},registerCommand(name:string,command:any){commands[name]=command},on(name:string,fn:any){handlers[name]=fn},getFlag(name:string){return name==='worktree-watch'?false:'refs/heads/main'},sendMessage(){throw Error('unexpected host message')}};
  const ctx={mode:'tui',hasUI:true,cwd:repo,sessionManager:{getSessionId:()=>session,getHeader:()=>({id:session,timestamp:'2026-01-01T00:00:00.000Z'}),getSessionFile:()=>undefined,getBranch:()=>[],getEntries:()=>[],getLeafId:()=>null},isIdle:()=>true,hasPendingMessages:()=>false,ui:{notify(...args:unknown[]){notices.push(args)},select:()=>selection}};
  extension(pi as any);return{handlers,commands,notices,ctx,setSession(value:string){session=value},setSelection(value:Promise<string>){selection=value}};
}
test('stale pi menu does not leave a different session', {skip:process.platform==='win32'}, async(t)=>{
  const f=await fixture(t), log=join(f.base,'calls');await writeFile(log,'');await writeFile(join(f.bin,'git'),`#!/bin/sh\nprintf x >> ${shellQuote(log)}\nexec ${shellQuote(f.gitPath)} "$@"\n`,{mode:0o755});
  const h=host(f.repo);f.setFinish(async()=>{await h.handlers.session_shutdown()});await h.handlers.session_start({},h.ctx);let select!: (action:string)=>void;h.setSelection(new Promise(r=>select=r));
  const pending=h.commands.worktree.handler('',h.ctx);h.setSession('new');select('leave');await pending;
  assert.equal(await readFile(log,'utf8'),'');assert.deepEqual(h.notices,[]);await h.handlers.session_shutdown();
});
test('join already started before shutdown keeps original identity and does not restart the watcher', {skip:process.platform==='win32',timeout:15000},async(t)=>{
  const f=await fixture(t),marker=join(f.base,'waiting'),release=join(f.base,'release');
  await writeFile(join(f.bin,'git'),`#!/bin/sh\nif [ "$3" = check-ref-format ]; then : > ${shellQuote(marker)}; tries=0; while [ ! -f ${shellQuote(release)} ] && [ "$tries" -lt 100 ]; do /bin/sleep 0.05; tries=$((tries + 1)); done; [ -f ${shellQuote(release)} ] || exit 70; fi\nexec ${shellQuote(f.gitPath)} "$@"\n`,{mode:0o755});
  let pending: Promise<void> | undefined;
  const previousWarn=console.warn,warnings:unknown[][]=[];console.warn=(...args:unknown[])=>{warnings.push(args)};
  const originalSetInterval=globalThis.setInterval;let timersStarted=0;
  globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>{timersStarted++;return originalSetInterval(...args)}) as typeof setInterval;
  const h=host(f.repo);f.setFinish(async()=>{let releaseError: unknown;try{try{await writeFile(release,'release')}catch(error){releaseError=error}await pending?.catch(()=>{});await h.handlers.session_shutdown();if(releaseError)throw releaseError}finally{console.warn=previousWarn;globalThis.setInterval=originalSetInterval}});await h.handlers.session_start({},h.ctx);pending=h.commands.worktree.handler('join',h.ctx);
  let reached=false;for(let i=0;i<1000;i++){try{await access(marker);reached=true;break}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}await delay(10)}assert.ok(reached);
  await h.handlers.session_shutdown();h.setSession('new');await writeFile(release,'release');await pending;
  const ids=await readdir(join(f.state,'repos')),sessions: any[]=[];
  for(const id of ids)if(/^[a-f0-9]{64}$/.test(id))for(const file of await readdir(join(f.state,'repos',id,'sessions')))if(file.endsWith('.json'))sessions.push(JSON.parse(await readFile(join(f.state,'repos',id,'sessions',file),'utf8')));
  assert.deepEqual(sessions.map(s=>s.session),['old']);assert.deepEqual(h.notices,[]);assert.equal(warnings.length,1);assert.equal(timersStarted,0);
});
