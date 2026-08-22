#!/usr/bin/env node
import fs from 'fs';
import { putstr } from './tty/output';
import path from 'path';

import { isWindows } from './tty/platform';

import pager, { pagerPipe } from './index';

import { openTtyKeyboard } from './tty/keyboard';

import { printVersion } from './features/misc';

import { closeAlt, errorText, files as fileList, initFiles, openForCat }
  from './features/files';

import {
  OptionSpec,
  opt,
  optionArgPending,
  optionDesc,
  setCliOptions
} from './options';

import { help } from './startup/lessHelp';

import { lesskeyHelp } from './startup/lesskeyHelp';

import { lesskeyViewFiles, applyLesskeyEdits, cleanLesskeyView,
  createLesskeyFile, markLesskeyViewSession }
  from './lesskey/view';

import { LESS_VERSION } from './lesskey';

import { initInvocationOptions, markTerminalInvocation }
  from './startup/invocation';

import { actualEnv, initEnvironment, lgetenv } from './startup/environment';

import { initSecure, secureAllow } from './features/secure';

import { loadLesskey } from './lesskey';

import { startupInit } from './startup/startup';

import { search } from './features/searching';

/**
 * The `lmn` command, mirroring less main.c's startup: $LESS scans
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
 * pass them through literally, like less's main.c globbing each
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
  // init_cmds precedes argv classification in less, so lesskey #env may
  // define $LESS/$MORE options whose pending argument consumes argv.
  initSecure();
  // QUIETLY: startupInit parses these again once the session state is
  // up, and THAT pass is the one whose diagnostics are less's. This one
  // exists only so the #env lines are in place before argv is split
  if (secureAllow('lesskey')) loadLesskey(true);
  const argv = process.argv.slice(2);
  const files: string[] = [];
  const optArgs: string[] = [];
  let endOpts = false;
  let sawTag = false;
  const posixlyCorrect = actualEnv('POSIXLY_CORRECT') !== undefined;

  // less scans $LESS (or $MORE) before argv, so an option left dangling
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
      // its value, like less's isoptpending in the argv loop
      optArgs.push(arg);
      pending = optionArgPending(arg, pending, spec => {
        if (spec.letter === 't') sawTag = true;
      });
    } else {
      if (posixlyCorrect) endOpts = true;
      files.push(...globArg(arg));
    }
  }

  // less's main quits when the last option still wants a value
  if (pending !== null) {
    usageError(`Value is required after ${optionDesc(pending)}`);
  }

  // less's main: -t selects the file, so filenames are not allowed
  if (sawTag && files.length) {
    usageError('No filenames allowed with -t option');
  }

  // -V/--version prints and exits, like less's opt__V at startup
  if (optArgs.some(a => a === '-V' || a === '--version')) {
    printVersion();
    return;
  }

  // -?/--help makes the help file an input, like less's dohelp
  // registering FAKE_HELPFILE, so no filename is required
  const wantsHelp = optArgs.some(a => a === '-?' || a === '--help');

  // --lesskey-help pages the lesskey syntax the same way, as its
  // own input file. Not a less switch: less has `man lesskey` and an
  // npm install has nothing.
  const wantsLesskeyHelp = optArgs.some(a => a === '--lesskey-help');
  const wantsViewLesskey = optArgs.some(a => a === '--view-lesskey');

  // command line options scan after $LESS, one scan_option call per
  // argument like less's main (a "$" separator would break long names)
  // --view-lesskey with no file BECOMES the session, so the forms are
  // already the file list by the time the scan runs. Left in, the
  // scan would open the view a second time over itself, and it took
  // two q's to get out of one screen
  setCliOptions(wantsViewLesskey && !files.length
    ? optArgs.filter(arg => arg !== '--view-lesskey')
    : optArgs);

  const stdoutTty = process.stdout.isTTY === true;

  // less's whole mode turns on isatty(1) alone (main.c:259), and its
  // keyboard NEVER comes from fd 0: open_getchr goes through
  // open_tty's cascade whatever stdin is (ttyin.c:67, :138). Taking
  // stdin when it happened to be a terminal was our own shortcut, and
  // it showed: with no controlling terminal and stderr redirected, less
  // runs out of cascade and quits while we read the pty on stdin and
  // carried on.
  const stdinTty = process.stdin.isTTY === true;

  if (!stdoutTty) {
    // not a terminal: copy input to output, like less's cat_file loop;
    // --help makes the help file the first input
    if (wantsHelp) putstr(help.join('\n') + '\n');
    if (wantsLesskeyHelp) putstr(lesskeyHelp.join('\n') + '\n');

    if (files.length) {
      // less reaches the cat loop through its ordinary startup: the
      // option scan, the lesskey files and $LESSOPEN all still apply
      // with output on a pipe, because main.c:376 runs edit_first()
      // before it starts copying (edit.c:936)
      markTerminalInvocation();
      initInvocationOptions();
      startupInit([]);

      initFiles(files);
      let opened = 0;

      // less runs `set_output(1, TRUE)` only AFTER edit_first() finds a
      // file it can open (main.c:413, moved there by e1fdd8c2). Until
      // then its output fd is still stderr, so the errors from every
      // name tried before the first success land on stderr - that is
      // what keeps "less fifo >out" from writing the complaint INTO
      // out. Once a file has opened, later errors go to stdout with
      // the text. Verified against the binary both ways round.
      const reportOpenError = (message: string): void => {
        const stream = opened === 0 ? process.stderr : process.stdout;
        stream.write(message + '\n');
      };

      for (let i = 0; i < files.length; i++) {
        const source = await openForCat(i, process.stdout);

        if (!source) {
          // less's edit_ifile error()s and edit_istep moves on to the
          // next name; only a list where NOTHING opens is an error
          reportOpenError(search.message || files[i]);
          search.message = '';
          continue;
        }

        // a pipe preprocessor has already written its own bytes
        if (source.path !== undefined) {
          const from = source.path;

          try {
            await new Promise<void>((res, rej) => {
              const rs = fs.createReadStream(from);
              rs.on('error', rej);
              rs.on('end', res);
              rs.pipe(process.stdout, { end: false });
            });
          } catch (error) {
            // bad_file cannot see this one: stat SUCCEEDS on a file
            // whose mode denies reading, so less finds out at the open
            // and reports errno_message(filename) - "%s: %s" with
            // strerror (os.c:450, used at edit.c:558) - then edit_istep
            // moves to the next name. Letting the reject reach the
            // top-level handler printed node's own "Error: EACCES:
            // permission denied, open 'x'" and abandoned the rest of
            // the list.
            reportOpenError(`${files[i]}: ${errorText(error)}`);
            closeAlt(fileList.list[i]);
            continue;
          }
        }

        opened++;

        // leaving the file runs $LESSCLOSE, like close_file; quit()
        // does the same for the last one through edit(NULL)
        closeAlt(fileList.list[i]);
      }

      // less's main quits QUIT_ERROR only when edit_first found no file
      // it could open at all
      if (!opened) process.exitCode = 1;
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

  // less's edit_ifile reads the name "-" from standard input (edit.c:516)
  // and, having skipped bad_file, is the one place that reaches the
  // isatty guard below it: a terminal on fd0 is refused, and with no
  // other file to fall back on edit_first quits QUIT_ERROR
  if (files.length === 1 && files[0] === '-') {
    if (stdinTty && !opt.forceOpen) {
      process.stderr.write('- is a terminal (use -f to open it)\n');
      process.exitCode = 1;
      return;
    }

    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();
    await pagerPipe(process.stdin);
    return;
  }

  // --view-lesskey WITH files opens over them, so quitting the view
  // leaves the session on the file that was asked for - the same
  // stash the runtime form makes. Only on its own does it become the
  // session, and then there is nothing underneath to go back to
  if (wantsViewLesskey && !files.length) {
    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();

    // no session to stash out here, so the forms simply ARE the file
    // list; the runtime form swaps them over a live one instead
    const view = lesskeyViewFiles();

    markLesskeyViewSession(view.files);

    if (view.files.length === 1 && view.files[0].form === null) {
      createLesskeyFile(view.files[0].path);
    }

    try {
      await pager(view.files.map(file => file.path), ['--examine-file']);
    } finally {
      const messages = applyLesskeyEdits(view.files, LESS_VERSION);

      cleanLesskeyView(view.dir);

      for (const message of messages) putstr(message + '\n');
    }

    return;
  }

  if (files.length) {
    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();
    await pager(files, ['--examine-file']);
    return;
  }

  if (wantsLesskeyHelp) {
    // as --help does with no files; WITH a file, startup.lesskeyHelp
    // pages the syntax first and the file after it
    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();
    await pager(lesskeyHelp.join('\n'));
    return;
  }

  if (wantsHelp) {
    // `lmn --help` with no files pages the help file alone, like
    // less's dohelp making FAKE_HELPFILE the only input
    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();
    await pager(help.join('\n'));
    return;
  }

  if (sawTag) {
    // -t supplies the file itself: the queued tag jump opens the
    // file containing the tag, like less's main editing the tag file
    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();
    await pager('');
    return;
  }

  if (!stdinTty) {
    // `cmd | lmn`: page the stream as it arrives, keyboard from
    // /dev/tty like ttyin.c; less never waits for a pipe to end, so
    // an endless writer pages immediately
    if (!openTtyKeyboard()) usageError('cannot open terminal');

    markTerminalInvocation();
    await pagerPipe(process.stdin);
    return;
  }

  usageError('Missing filename ("lmn --help" for help)');
}

main().then(() => {
  // less's quit() ends the process outright (exit()); node would
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
