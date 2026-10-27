import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createWatcher } from '../dist/adapters/pi/watch.js';
const dir=await mkdtemp(join(tmpdir(),'gitrelay-pi-large-')), saved=process.env.WORKTREE_SYNC_STATE_DIR;
const git=(...args)=>execFileSync('git',['-C',dir,'-c','user.name=Test','-c','user.email=t@invalid','-c','commit.gpgsign=false',...args],{stdio:'ignore'});
try {
 process.env.WORKTREE_SYNC_STATE_DIR=join(dir,'state'); git('init','-b','main'); await writeFile(join(dir,'x'),'x'); git('add','x');git('commit','-m','initial');
 const manager=SessionManager.create(dir,join(dir,'sessions')); manager.appendMessage({role:'user',content:[{type:'text',text:'baseline'}],timestamp:Date.now()});
 const payload='x'.repeat(1024*1024); for(let i=0;i<40;i++)manager.appendCustomEntry('unrelated',{i,payload});
 const warnings=[], watcher=createWatcher({sendMessage(){assert.fail('no events expected')}},{cwd:dir,hasPendingMessages:()=>false,isIdle:()=>true,sessionManager:manager,ui:{notify(m){warnings.push(m)}}},'refs/heads/main');
 global.gc?.(); const rssBefore=process.memoryUsage().rss, peakBefore=process.resourceUsage().maxRSS, cpuBefore=process.cpuUsage(), start=performance.now(); await watcher.tick(); const elapsed=performance.now()-start,cpu=process.cpuUsage(cpuBefore); global.gc?.(); const rssAfter=process.memoryUsage().rss, peakAfter=process.resourceUsage().maxRSS;
 assert.deepEqual(warnings,[]); await watcher.stop(); console.log(JSON.stringify({fileBytes:(await stat(manager.getSessionFile())).size,elapsedMs:+elapsed.toFixed(1),userMs:cpu.user/1000,systemMs:cpu.system/1000,rssBefore,rssAfter,peakBeforeKiB:peakBefore,peakAfterKiB:peakAfter}));
}finally{if(saved===undefined)delete process.env.WORKTREE_SYNC_STATE_DIR;else process.env.WORKTREE_SYNC_STATE_DIR=saved;await rm(dir,{recursive:true,force:true})}
