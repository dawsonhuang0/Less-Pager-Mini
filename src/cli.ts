#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

import { isWindows } from './tty/platform';

import pager, { pagerPipe } from './index';

import { openTtyKeyboard } from './tty/keyboard';

import { printVersion } from './features/misc';

import { errorText } from './features/files';

import {
  OptionSpec,
  opt,
  optionArgPending,
  optionDesc,
  setCliOptions
} from './options';

import { help } from './startup/lessHelp';

import { markTerminalInvocation } from './startup/invocation';

import { actualEnv, initEnvironment, lgetenv } from './startup/environment';

import { initSecure, secureAllow } from './features/secure';

import { loadLesskey } from './features/lesskey';

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

/**
 * Expands *?* filename patterns on Windows, where the console shells
 * pass them through literally, like og's main.c globbing each
 * argument on the MSDOS builds; an unmatched pattern stays literal
 * so the open error can report it.
 */
function globArg(name: string): string[] {
  if (!isWindows || !/[*?]/.test(name)) return [name];

  const dir = path.dirname(name);
  const rx = new RegExp('^' + [...path.basename(name)].map(char =>
    char === '*' ? '[^/\\\\]*'
      : char === '?' ? '[^/\\\\]'
        : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  ).join('') + '$', 'i');

  try {
    const hits = fs.readdirSync(dir)
      .filter(entry => rx.test(entry))
      .sort()
      .map(entry => path.join(dir, entry));

    return hits.length ? hits : [name];
  } catch {
    return [name];
  }
}

async function main(): Promise<void> {
  initEnvironment();
  // init_cmds precedes argv classification in og, so lesskey #env may
  // define $LESS/$MORE options whose pending argument consumes argv.
  initSecure();
  if (secureAllow('lesskey')) loadLesskey();
  const argv = process.argv.slice(2);
  const files: string[] = [];
  const optArgs: string[] = [];
  let endOpts = false;
  let sawTag = false;
  const posixlyCorrect = actualEnv('POSIXLY_CORRECT') !== undefined;

  // og scans $LESS (or $MORE) before argv, so an option left dangling
  // at the end of the environment consumes the first argument
  const lim = lgetenv('LESS_IS_MORE');
  opt.lessIsMore = lim !== undefined && lim !== '' && lim !== '0' ? 1 : 0;

  let pending: OptionSpec | null = optionArgPending(
    lgetenv(opt.lessIsMore ? 'MORE' : 'LESS') ?? '', null);

  const isOptString = (s: string): boolean =>
    (s[0] === '-' || s[0] === '+') && s.length > 1;

  for (const arg of argv) {
    if (!endOpts && arg === '--') {
      endOpts = true;
    } else if (!endOpts && (isOptString(arg) || pending !== null)) {
      // a dangling string/number option takes the next argument as
      // its value, like og's isoptpending in the argv loop
      optArgs.push(arg);
      pending = optionArgPending(arg, pending, spec => {
        if (spec.letter === 't') sawTag = true;
      });
    } else {
      if (posixlyCorrect) endOpts = true;
      files.push(...globArg(arg));
    }
  }

  // og's main quits when the last option still wants a value
  if (pending !== null) {
    usageError(`Value is required after ${optionDesc(pending)}`);
  }

  // og's main: -t selects the file, so filenames are not allowed
  if (sawTag && files.length) {
    usageError('No filenames allowed with -t option');
  }

  // -V/--version prints and exits, like og's opt__V at startup
  if (optArgs.some(a => a === '-V' || a === '--version')) {
    printVersion();
    return;
  }

  // -?/--help makes the help file an input, like og's dohelp
  // registering FAKE_HELPFILE, so no filename is required
  const wantsHelp = optArgs.some(a => a === '-?' || a === '--help');

  // command line options scan after $LESS, one scan_option call per
  // argument like og's main (a "$" separator would break long names)
  setCliOptions(optArgs);

  const stdoutTty = process.stdout.isTTY === true;
  const stdinTty = process.stdin.isTTY === true;

  if (!stdoutTty) {
    // not a terminal: copy input to output, like og's cat_file loop;
    // --help makes the help file the first input
    if (wantsHelp) process.stdout.write(help.join('\n') + '\n');

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
          process.stderr.write(`${f}: ${errorText(error)}\n`);
          process.exitCode = 1;
        }
      }
    } else if (wantsHelp) {
      // the help file was the only input
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

    markTerminalInvocation();
    await pager(files, false, true);
    return;
  }

  if (wantsHelp) {
    // `lmn --help` with no files pages the help file alone, like
    // og's dohelp making FAKE_HELPFILE the only input (a piped
    // stdin is ignored, but still needs the /dev/tty keyboard)
    if (!stdinTty && !openTtyKeyboard()) {
      usageError('cannot open terminal');
    }

    markTerminalInvocation();
    await pager(help.join('\n'), true, false);
    return;
  }

  if (sawTag) {
    // -t supplies the file itself: the queued tag jump opens the
    // file containing the tag, like og's main editing the tag file
    if (!stdinTty && !openTtyKeyboard()) {
      usageError('cannot open terminal');
    }

    markTerminalInvocation();
    await pager('', true, false);
    return;
  }

  if (!stdinTty) {
    // `cmd | lmn`: page the stream as it arrives, keyboard from
    // /dev/tty like ttyin.c; og never waits for a pipe to end, so
    // an endless writer pages immediately
    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();
    await pagerPipe(process.stdin);
    return;
  }

  usageError('Missing filename ("lmn --help" for help)');
}

main().then(() => {
  // og's quit() ends the process outright (exit()); node would
  // otherwise sit on the closed stdin pipe until the writer's next
  // write lets the loop drain — a visible pause before the shell
  // prompt. TTY writes are synchronous, so nothing is truncated;
  // the non-tty cat paths keep node's graceful flush.
  if (process.stdout.isTTY) process.exit(typeof process.exitCode === 'number'
      ? process.exitCode : 0);
}, error => {
  process.stderr.write(String(error) + '\n');
  process.exit(1);
});
