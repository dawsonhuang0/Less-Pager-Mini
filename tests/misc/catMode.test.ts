import { afterAll, describe, expect, it } from 'vitest';

import { spawnSync } from 'child_process';

import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * less reaches its cat loop through the ordinary startup: main.c:376
 * runs edit_first() - the same edit_ifile every session uses, so
 * $LESSOPEN, the option scan and $LESSCLOSE all apply - and only then
 * copies bytes with cat_file (edit.c:936).
 *
 * These drive the real executable, because the branch under test is
 * the one the library never takes.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-cat-'));
const cli = path.join(__dirname, '..', '..', 'src', 'cli.ts');

// the local binary, never `npx`: npm writes notices of its own to the
// child's streams ("npm notice run ...", and a warning about whatever
// .npmrc it was handed), and these cases assert the exact bytes the
// pager produced
const tsx = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

const real = path.join(dir, 'real.txt');
const aux = path.join(dir, 'aux.txt');
const missing = path.join(dir, 'nope.txt');
const closeLog = path.join(dir, 'close.log');

fs.writeFileSync(real, 'real line\n');
fs.writeFileSync(aux, 'aux line\n');

// a preprocessor and a closer, both plain shell
const pre = path.join(dir, 'pre.sh');
const post = path.join(dir, 'post.sh');
fs.writeFileSync(pre, '#!/bin/sh\necho "PREPROCESSED $1"\n');
fs.writeFileSync(post, `#!/bin/sh\necho "closed $1" >> ${closeLog}\n`);
fs.chmodSync(pre, 0o755);
fs.chmodSync(post, 0o755);

/** Runs the CLI with stdout on a pipe, like `lmn file | cat`. */
function cat(
  args: string[],
  env: Record<string, string> = {}
): { out: string, err: string, code: number } {
  const result = spawnSync(tsx, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LESSHISTFILE: '-', ...env },
  });

  return {
    out: result.stdout ?? '',
    err: result.stderr ?? '',
    code: result.status ?? 0,
  };
}

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('a non-terminal session cats through the normal open path', () => {
  it('copies the file when nothing preprocesses it', () => {
    const { out, code } = cat([real]);

    expect(out).toBe('real line\n');
    expect(code).toBe(0);
  });

  it('applies $LESSOPEN, like edit_first before cat_file', () => {
    const { out } = cat([real], { LESSOPEN: `|${pre} %s` });

    expect(out).toBe(`PREPROCESSED ${real}\n`);
  });

  it('honours -L against it, so the scan really ran', () => {
    const { out } = cat(['-L', real], { LESSOPEN: `|${pre} %s` });

    expect(out).toBe('real line\n');
  });

  it('runs $LESSCLOSE for every file it leaves', () => {
    fs.writeFileSync(closeLog, '');
    cat([real, aux], { LESSOPEN: `|${pre} %s`, LESSCLOSE: `${post} %s %s` });

    expect(fs.readFileSync(closeLog, 'utf8')).toBe(
      `closed ${real}\nclosed ${aux}\n`
    );
  });

  it('reports an unopenable file but keeps going, like edit_istep', () => {
    const { out, err, code } = cat([missing, real]);

    expect(out).toBe('real line\n');
    expect(err).toBe(`${missing}: No such file or directory\n`);
    // less quits QUIT_ERROR only when edit_first opened nothing at all
    expect(code).toBe(0);
  });

  it('exits 1 when no file opens', () => {
    const { out, code } = cat([missing]);

    expect(out).toBe('');
    expect(code).toBe(1);
  });

  it('copies a preprocessor\'s bytes intact', () => {
    // cat_file reads the altpipe with ch_forw_get: no decoding, so
    // bytes that are not valid UTF-8 must survive the round trip
    const bin = path.join(dir, 'bin.dat');
    const bytes = Buffer.from([0x00, 0xFF, 0xFE, 0x80, 0x41, 0x0A]);
    fs.writeFileSync(bin, bytes);

    const passthrough = path.join(dir, 'pass.sh');
    fs.writeFileSync(passthrough, '#!/bin/sh\ncat "$1"\n');
    fs.chmodSync(passthrough, 0o755);

    const result = spawnSync(tsx, [cli, bin], {
      env: { ...process.env, LESSHISTFILE: '-',
        LESSOPEN: `|${passthrough} %s` },
    });

    expect(result.stdout.equals(bytes)).toBe(true);
  });

  it('interleaves the preprocessor\'s own stderr, like a live pipe', () => {
    // less keeps the popen stream open and reads through it as it
    // copies (open_altfile's returnfd branch), so the child is still
    // running while its output is written and its stderr lands
    // BETWEEN its stdout. Collecting the output first would put every
    // byte of stderr in front. The sleep makes the order a fact
    // rather than a race.
    const noisy = path.join(dir, 'noisy.sh');
    fs.writeFileSync(noisy,
      '#!/bin/sh\necho before\nsleep 0.3\necho oops >&2\necho after\n');
    fs.chmodSync(noisy, 0o755);

    const merged = spawnSync('sh', ['-c', `${tsx} ${cli} ${real} 2>&1`], {
      encoding: 'utf8',
      env: { ...process.env, LESSHISTFILE: '-', LESSOPEN: `|${noisy} %s` },
    });

    expect(merged.stdout).toBe('before\noops\nafter\n');
  });

  it('copies bytes, not lines', () => {
    // no trailing newline, and cat_file adds none
    const raw = path.join(dir, 'raw.txt');
    fs.writeFileSync(raw, 'no newline at eof');

    expect(cat([raw]).out).toBe('no newline at eof');
  });
});
