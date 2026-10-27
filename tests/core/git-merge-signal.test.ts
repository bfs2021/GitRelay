import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectChange } from '../../src/core/changes.ts';
import { fixture } from '../helpers.ts';

test('merge-base signal termination preserves underlying failure', { skip: process.platform === 'win32' }, async (t) => {
 const f=await fixture(t); const bin=join(f.root,'bin-signal'); await mkdir(bin);
 await writeFile(join(bin,'git'), `#!/bin/sh\ncase "$*" in *' merge-base '*) kill -TERM $$;; esac\nPATH="$GIT_RELAY_TEST_PATH" exec git "$@"\n`); await chmod(join(bin,'git'),0o755);
 const old=process.env.PATH; const oldTestPath=process.env.GIT_RELAY_TEST_PATH; process.env.GIT_RELAY_TEST_PATH=old; process.env.PATH=`${bin}:${old}`;
 try { await assert.rejects(inspectChange({root:f.b,ref:'refs/heads/main',commit:f.initial},f.initial), (error: any) => error.cause?.signal === 'SIGTERM' && !error.message.includes('could not compare')); }
 finally { process.env.PATH=old; if (oldTestPath === undefined) delete process.env.GIT_RELAY_TEST_PATH; else process.env.GIT_RELAY_TEST_PATH=oldTestPath; }
});

test('pre-aborted merge-base preserves caller reason', async (t) => {
 const f=await fixture(t), reason=new Error('caller cancelled');
 await assert.rejects(inspectChange({root:f.b,ref:'refs/heads/main',commit:f.initial},f.initial,AbortSignal.abort(reason)), error => error === reason);
});
