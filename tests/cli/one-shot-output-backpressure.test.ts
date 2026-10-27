import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';

const cli = join(process.cwd(), 'src/cli/main.ts');
const children = new WeakMap<TestContext, { child: ChildProcess; done: Promise<unknown> }[]>();
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'gitrelay-one-shot-output-'));
  t.after(async () => {
    for (const { child, done } of children.get(t) ?? []) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await done.catch(() => {});
    }
    if (!process.env.GITRELAY_KEEP_TEST_FIXTURES) await rm(base, { recursive: true, force: true });
  });
  const home = join(base, 'home'), template = join(base, 'template'), bin = join(base, 'bin'), repo = join(base, 'repo');
  for (const path of [home, template, bin]) await mkdir(path);
  const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: base, XDG_CONFIG_HOME: join(base, 'config'), XDG_STATE_HOME: join(base, 'state'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  execFileSync('git', ['init', '--template', template, '-b', 'main', repo], { env, stdio: 'ignore' });
  return { base, bin, repo, env };
}
function watch(t: TestContext, child: ChildProcess) {
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const tracked = children.get(t) ?? []; tracked.push({ child, done }); children.set(t, tracked);
  return async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), 5000); });
      const result = await Promise.race([done, timeout]);
      assert.notEqual(result, 'timeout', 'child did not exit with a blocked pipe');
      return result;
    } finally { if (timer) clearTimeout(timer); }
  };
}

test('one-shot fatal diagnostics stay bounded and exit with unread stderr', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  const { bin, env, repo } = await fixture(t);
  const executable = join(bin, 'git');
  await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} -e ${shellQuote("process.stderr.write('x'.repeat(2000000)); process.exitCode=77;")}\n`);
  await chmod(executable, 0o755);
  const child = spawn(process.execPath, ['--experimental-strip-types', cli, 'status', '--cwd', repo], { env: { ...env, PATH: `${bin}${delimiter}${env.PATH}` }, stdio: ['ignore', 'ignore', 'pipe'] });
  assert.deepEqual(await watch(t, child)(), { code: 1, signal: null });
  // stderr intentionally remains unread to exercise OS-pipe backpressure.
});

test('readable fatal diagnostics retain a prefix and truncation marker', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  const { bin, env, repo } = await fixture(t);
  const executable = join(bin, 'git');
  await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} -e ${shellQuote("process.stderr.write('x'.repeat(2000000)); process.exitCode=77;")}\n`);
  await chmod(executable, 0o755);
  const child = spawn(process.execPath, ['--experimental-strip-types', cli, 'status', '--cwd', repo], { env: { ...env, PATH: `${bin}${delimiter}${env.PATH}` }, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = watch(t, child);
  let stderr = ''; child.stderr!.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const stderrDone = new Promise<void>((resolve) => { child.stderr!.once('end', resolve); });
  assert.deepEqual(await exited(), { code: 1, signal: null });
  await stderrDone;
  assert.ok(stderr.startsWith('git-relay: '));
  assert.match(stderr, /\[diagnostic truncated\]\n$/);
  assert.ok(stderr.length < 4200);
});

test('oversize hook input exits successfully when stderr is blocked', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  const { base, env } = await fixture(t);
  const preload = join(base, 'fill-stderr.mjs');
  await writeFile(preload, "process.stderr.write('x'.repeat(1024 * 1024));\n");
  const child = spawn(process.execPath, ['--experimental-strip-types', '--import', preload, cli, 'hook', 'codex'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = watch(t, child);
  let out = ''; child.stdout!.setEncoding('utf8').on('data', (chunk) => { out += chunk; });
  const stdoutDone = new Promise<void>((resolve) => { child.stdout!.once('end', resolve); });
  child.stdin!.end(Buffer.alloc(16 * 1024 * 1024 + 1, 32));
  assert.deepEqual(await exited(), { code: 0, signal: null });
  await stdoutDone;
  assert.equal(out, '{}\n');
});

test('help reports an output error when stdout is closed', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  const { env } = await fixture(t);
  const child = spawn(process.execPath, ['--experimental-strip-types', cli, '--help'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = watch(t, child); child.stdout!.destroy();
  assert.deepEqual(await exited(), { code: 1, signal: null });
});

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  test(`watch help interrupted by ${signal} has a one-shot exit code`, { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
    const { base, env } = await fixture(t);
    const preload = join(base, 'fill-stdout.mjs');
    await writeFile(preload, "const write = process.stdout.write.bind(process.stdout); write('x'.repeat(1024 * 1024)); process.stdout.write = (...args) => { const result = write(...args); if (String(args[0]).startsWith('GitRelay (')) process.stderr.write('ready\\n'); return result; };\n");
    const child = spawn(process.execPath, ['--experimental-strip-types', '--import', preload, cli, 'status', '--watch', '--help'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = watch(t, child);
    let stderr = ''; child.stderr!.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const stderrDone = new Promise<void>((resolve) => { child.stderr!.once('end', resolve); });
    const deadline = performance.now() + 5000;
    while (!stderr.includes('ready\n') && performance.now() < deadline) await delay(20);
    assert.ok(stderr.includes('ready\n'), 'help did not reach the blocked write');
    child.kill(signal);
    assert.deepEqual(await exited(), { code, signal: null });
    await stderrDone;
    assert.match(stderr, /interrupted/);
  });
}
