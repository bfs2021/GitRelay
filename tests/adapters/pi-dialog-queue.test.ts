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
  const previous = Object.fromEntries(['PATH', 'WORKTREE_SYNC_STATE_DIR', 'WORKTREE_SYNC_REPOSITORY_IDS'].map((key) => [key, process.env[key]]));
  delete process.env.WORKTREE_SYNC_REPOSITORY_IDS;
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
test('same session leave waits for a join already in progress', {skip:process.platform==='win32',timeout:30000},async(t)=>{
  const f=await fixture(t),marker=join(f.base,'queue-waiting'),release=join(f.base,'queue-release'),log=join(f.base,'queue-calls');
  await writeFile(join(f.bin,'git'),`#!/bin/sh\nprintf '%s\\n' "$3" >> ${shellQuote(log)}\nif [ "$3" = check-ref-format ]; then : > ${shellQuote(marker)}; tries=0; while [ ! -f ${shellQuote(release)} ] && [ "$tries" -lt 100 ]; do /bin/sleep 0.05; tries=$((tries + 1)); done; [ -f ${shellQuote(release)} ] || exit 70; fi\nexec ${shellQuote(f.gitPath)} "$@"\n`,{mode:0o755});
  let first: Promise<void> | undefined,second: Promise<void> | undefined;
  const h=host(f.repo), originalSet=globalThis.setInterval, originalClear=globalThis.clearInterval;
  const timers=new Set<ReturnType<typeof setInterval>>();
  f.setFinish(async()=>{try{let releaseError:unknown;try{await writeFile(release,'release')}catch(error){releaseError=error}await Promise.allSettled([first,second]);await h.handlers.session_shutdown();if(releaseError)throw releaseError}finally{globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear}});
  globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>{const timer=originalSet(...args);if(args[1]===5000)timers.add(timer);return timer}) as typeof setInterval;
  globalThis.clearInterval=((timer:Parameters<typeof clearInterval>[0])=>{timers.delete(timer as ReturnType<typeof setInterval>);originalClear(timer)}) as typeof clearInterval;
  await h.handlers.session_start({},h.ctx);first=h.commands.worktree.handler('join',h.ctx);
  let reached=false;for(let i=0;i<1000;i++){try{await access(marker);reached=true;break}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}await delay(10)}assert.ok(reached);
  const before=await readFile(log,'utf8');second=h.commands.worktree.handler('leave',h.ctx);await delay(250);assert.equal(await readFile(log,'utf8'),before,'queued leave started Git before join finished');
  await writeFile(release,'release');await Promise.all([first,second]);
  assert.ok(h.notices.some(n=>String(n[0]).startsWith('Joined')));
  const ids=await readdir(join(f.state,'repos')),sessions: any[]=[];
  for(const id of ids)if(/^[a-f0-9]{64}$/.test(id))for(const file of await readdir(join(f.state,'repos',id,'sessions')))if(file.endsWith('.json'))sessions.push(JSON.parse(await readFile(join(f.state,'repos',id,'sessions',file),'utf8')));
  assert.deepEqual(sessions.map(s=>s.session),['old']);
  if(process.env.GITRELAY_EXPECT_RETAINED_LOCKS) {
    assert.ok(h.notices.some(n=>n[1]==='error' && /busy|lock/i.test(String(n[0]))));
    assert.equal(sessions[0].closedAt,undefined);
  } else {
    assert.ok(h.notices.some(n=>String(n[0]).startsWith('Left')));
    assert.equal(typeof sessions[0].closedAt,'string');
    assert.equal(timers.size,0,'leave must stop its watcher');
  }
  await h.handlers.session_shutdown();assert.equal(timers.size,0,'shutdown must stop all tracked watchers');
});

test('a reloaded host with a worktree alias waits for the old session operation', {skip:process.platform==='win32',timeout:30000},async(t)=>{
  const f=await fixture(t),marker=join(f.base,'reload-waiting'),release=join(f.base,'reload-release'),log=join(f.base,'reload-calls');
  await writeFile(join(f.bin,'git'),`#!/bin/sh\nprintf '%s\\n' "$3" >> ${shellQuote(log)}\nif [ "$3" = check-ref-format ]; then : > ${shellQuote(marker)}; tries=0; while [ ! -f ${shellQuote(release)} ] && [ "$tries" -lt 100 ]; do /bin/sleep 0.05; tries=$((tries + 1)); done; [ -f ${shellQuote(release)} ] || exit 70; fi\nexec ${shellQuote(f.gitPath)} "$@"\n`,{mode:0o755});
  const old=host(f.repo),fresh=host(`${f.repo}/.`);let first:Promise<void>|undefined,second:Promise<void>|undefined;
  f.setFinish(async()=>{let error:unknown;try{await writeFile(release,'release')}catch(e){error=e}await Promise.allSettled([first,second]);await old.handlers.session_shutdown();await fresh.handlers.session_shutdown();if(error)throw error});
  await old.handlers.session_start({},old.ctx);first=old.commands.worktree.handler('join',old.ctx);
  let reached=false;for(let i=0;i<1000;i++){try{await access(marker);reached=true;break}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}await delay(10)}assert.ok(reached);
  await old.handlers.session_shutdown();await fresh.handlers.session_start({},fresh.ctx);
  const before=await readFile(log,'utf8');second=fresh.commands.worktree.handler('leave',fresh.ctx);await delay(250);assert.equal(await readFile(log,'utf8'),before,'reloaded leave started before old join completed');
  await writeFile(release,'release');await Promise.all([first,second]);
  const ids=await readdir(join(f.state,'repos')),sessions:any[]=[];
  for(const id of ids)if(/^[a-f0-9]{64}$/.test(id))for(const file of await readdir(join(f.state,'repos',id,'sessions')))if(file.endsWith('.json'))sessions.push(JSON.parse(await readFile(join(f.state,'repos',id,'sessions',file),'utf8')));
  assert.deepEqual(sessions.map(s=>s.session),['old']);
  if(process.env.GITRELAY_EXPECT_RETAINED_LOCKS) {
    assert.ok(fresh.notices.some(n=>n[1]==='error' && /busy|lock/i.test(String(n[0]))));
    assert.equal(sessions[0].closedAt,undefined);
  } else {
    assert.ok(fresh.notices.some(n=>String(n[0]).startsWith('Left')));
    assert.equal(typeof sessions[0].closedAt,'string');
  }
});

test('different session IDs do not wait behind a gated join', {skip:process.platform==='win32',timeout:30000},async(t)=>{
  const f=await fixture(t),marker=join(f.base,'different-waiting'),release=join(f.base,'different-release'),log=join(f.base,'different-calls');
  await writeFile(join(f.bin,'git'),`#!/bin/sh\nprintf '%s\\n' "$3" >> ${shellQuote(log)}\nif [ "$3" = check-ref-format ]; then : > ${shellQuote(marker)}; tries=0; while [ ! -f ${shellQuote(release)} ] && [ "$tries" -lt 100 ]; do /bin/sleep 0.05; tries=$((tries + 1)); done; [ -f ${shellQuote(release)} ] || exit 70; fi\nexec ${shellQuote(f.gitPath)} "$@"\n`,{mode:0o755});
  const old=host(f.repo),other=host(f.repo);other.setSession('other');let first:Promise<void>|undefined,second:Promise<void>|undefined;
  f.setFinish(async()=>{let error:unknown;try{await writeFile(release,'release')}catch(e){error=e}await Promise.allSettled([first,second]);await old.handlers.session_shutdown();await other.handlers.session_shutdown();if(error)throw error});
  await old.handlers.session_start({},old.ctx);await other.handlers.session_start({},other.ctx);first=old.commands.worktree.handler('join',old.ctx);
  let reached=false;for(let i=0;i<1000;i++){try{await access(marker);reached=true;break}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}await delay(10)}assert.ok(reached);
  const before=await readFile(log,'utf8');second=other.commands.worktree.handler('leave',other.ctx);
  let progressed=false;for(let i=0;i<100;i++){if(await readFile(log,'utf8')!==before){progressed=true;break}await delay(10)}assert.ok(progressed,'unrelated session did not begin before release');
  await writeFile(release,'release');await Promise.all([first,second]);
});

test('shutdown skips a queued leave without closing the subscription', {skip:process.platform==='win32',timeout:30000},async(t)=>{
  const f=await fixture(t),marker=join(f.base,'shutdown-waiting'),release=join(f.base,'shutdown-release'),log=join(f.base,'shutdown-calls');
  await writeFile(join(f.bin,'git'),`#!/bin/sh\nprintf '%s|%s\\n' "$2" "$3" >> ${shellQuote(log)}\nif [ "$3" = check-ref-format ]; then : > ${shellQuote(marker)}; tries=0; while [ ! -f ${shellQuote(release)} ] && [ "$tries" -lt 100 ]; do /bin/sleep 0.05; tries=$((tries + 1)); done; [ -f ${shellQuote(release)} ] || exit 70; fi\nexec ${shellQuote(f.gitPath)} "$@"\n`,{mode:0o755});
  const active=host(f.repo),closing=host(`${f.repo}/.`);let first:Promise<void>|undefined,second:Promise<void>|undefined;
  f.setFinish(async()=>{let error:unknown;try{await writeFile(release,'release')}catch(e){error=e}await Promise.allSettled([first,second]);await active.handlers.session_shutdown();await closing.handlers.session_shutdown();if(error)throw error});
  await active.handlers.session_start({},active.ctx);await closing.handlers.session_start({},closing.ctx);
  first=active.commands.worktree.handler('join',active.ctx);
  let reached=false;for(let i=0;i<1000;i++){try{await access(marker);reached=true;break}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}await delay(10)}assert.ok(reached);
  second=closing.commands.worktree.handler('leave',closing.ctx);
  await delay(250);assert.ok(!(await readFile(log,'utf8')).split('\n').some(line=>line.startsWith(`${f.repo}/.|`)),'leave started before shutdown');
  await closing.handlers.session_shutdown();await writeFile(release,'release');await Promise.all([first,second]);
  assert.ok(!(await readFile(log,'utf8')).split('\n').some(line=>line.startsWith(`${f.repo}/.|`)),'queued leave invoked Git after shutdown');
  assert.deepEqual(closing.notices,[]);
  const ids=await readdir(join(f.state,'repos')),sessions:any[]=[];
  for(const id of ids)if(/^[a-f0-9]{64}$/.test(id))for(const file of await readdir(join(f.state,'repos',id,'sessions')))if(file.endsWith('.json'))sessions.push(JSON.parse(await readFile(join(f.state,'repos',id,'sessions',file),'utf8')));
  assert.deepEqual(sessions.map(s=>s.session),['old']);assert.equal(sessions[0].closedAt,undefined);
});

test('a failed join releases the session queue for a later leave', {skip:process.platform==='win32',timeout:30000},async(t)=>{
  const f=await fixture(t),marker=join(f.base,'failed-waiting'),release=join(f.base,'failed-release'),log=join(f.base,'failed-calls');
  await writeFile(join(f.bin,'git'),`#!/bin/sh\nprintf '%s\\n' "$3" >> ${shellQuote(log)}\nif [ "$3" = check-ref-format ]; then : > ${shellQuote(marker)}; tries=0; while [ ! -f ${shellQuote(release)} ] && [ "$tries" -lt 100 ]; do /bin/sleep 0.05; tries=$((tries + 1)); done; printf 'injected Git failure\\n' >&2; exit 75; fi\nexec ${shellQuote(f.gitPath)} "$@"\n`,{mode:0o755});
  const h=host(f.repo);let first:Promise<void>|undefined,second:Promise<void>|undefined;
  f.setFinish(async()=>{let error:unknown;try{await writeFile(release,'release')}catch(e){error=e}await Promise.allSettled([first,second]);await h.handlers.session_shutdown();if(error)throw error});
  await h.handlers.session_start({},h.ctx);first=h.commands.worktree.handler('join',h.ctx);
  let reached=false;for(let i=0;i<1000;i++){try{await access(marker);reached=true;break}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}await delay(10)}assert.ok(reached);
  const before=await readFile(log,'utf8');second=h.commands.worktree.handler('leave',h.ctx);await delay(250);assert.equal(await readFile(log,'utf8'),before,'leave started before the failed join settled');
  await writeFile(release,'release');await first;
  let progressed=false;for(let i=0;i<100;i++){if(await readFile(log,'utf8')!==before){progressed=true;break}await delay(10)}assert.ok(progressed,'leave did not proceed after join failed');
  await second;assert.ok(h.notices.some(n=>n[1]==='error' && String(n[0]).includes('injected Git failure')));
});
