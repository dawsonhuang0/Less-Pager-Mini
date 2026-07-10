#!/usr/bin/env node
import fs from 'fs';

import pager from './index';

import { openTtyKeyboard } from './keyboard';

import { printVersion } from './features/misc';

/**
 * The `lmn` command, mirroring og main.c's startup: $LESS scans
 * first (inside the pager), then command line options override;
 * options and filenames may be mixed, `--` ends options, and
 * POSIXLY_CORRECT stops option scanning at the first filename.
 */

function usageError(message: string): never {
  process.stderr.write(message + '\n');
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const files: string[] = [];
  const optArgs: string[] = [];
  let endOpts = false;
  const posixlyCorrect = process.env.POSIXLY_CORRECT !== undefined;

  const isOptString = (s: string): boolean =>
    (s[0] === '-' || s[0] === '+') && s.length > 1;

  for (const arg of argv) {
    if (!endOpts && arg === '--') {
      endOpts = true;
    } else if (!endOpts && isOptString(arg)) {
      optArgs.push(arg);
    } else {
      if (posixlyCorrect) endOpts = true;
      files.push(arg);
    }
  }

  // -V/--version prints and exits, like og's opt__V at startup
  if (optArgs.some(a => a === '-V' || a === '--version')) {
    printVersion();
    return;
  }

  // command line options append to $LESS: the pager's scanner reads
  // the env once, so options ride in through it (each argument is
  // self-terminating, like og calling scan_option per arg)
  if (optArgs.length) {
    const joined = optArgs.join('$');
    process.env.LESS = (process.env.LESS ?? '') + '$' + joined + '$';
  }

  const stdoutTty = process.stdout.isTTY === true;
  const stdinTty = process.stdin.isTTY === true;

  if (!stdoutTty) {
    // not a terminal: copy input to output, like og's cat_file loop
    if (files.length) {
      for (const f of files) {
        try {
          await new Promise<void>((res, rej) => {
            const rs = fs.createReadStream(f);
            rs.on('error', rej);
            rs.on('end', res);
            rs.pipe(process.stdout, { end: false });
          });
        } catch (error) {
          process.stderr.write(`${f}: ${String(error)}\n`);
        }
      }
    } else if (!stdinTty) {
      await new Promise<void>(res => {
        process.stdin.pipe(process.stdout, { end: false });
        process.stdin.on('end', res);
      });
    } else {
      usageError('Missing filename ("lmn --help" for help)');
    }

    return;
  }

  if (files.length) {
    // a piped stdin alongside files still needs a keyboard
    if (!stdinTty && !openTtyKeyboard()) {
      usageError('cannot open terminal');
    }

    await pager(files, false, true);
    return;
  }

  if (!stdinTty) {
    // `cmd | lmn`: page stdin, keyboard from /dev/tty like ttyin.c
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }

    if (!openTtyKeyboard()) usageError('cannot open terminal');

    await pager(Buffer.concat(chunks).toString(), true, false);
    return;
  }

  usageError('Missing filename ("lmn --help" for help)');
}

main().catch(error => {
  process.stderr.write(String(error) + '\n');
  process.exit(1);
});
