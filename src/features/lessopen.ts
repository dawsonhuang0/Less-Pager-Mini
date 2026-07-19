import fs from 'fs';

import { secureAllow } from "./secure";

import { spawnSync, SpawnSyncReturns } from 'child_process';

import { shellArgv } from '../platform';

import { search } from "./searching";

import { shellQuote } from "./prompt";

import { optUseLessopen, optShowPreprocError } from "../options";

import { gateReturn } from "../keyboard";

/** A $LESSOPEN replacement: its lines, byte size and alt file name. */
export interface AltFile {
  lines: string[];
  size: number;
  /** `-` for pipe preprocessors, the temp file name otherwise. */
  alt: string;
  /** The pipe preprocessor's failure message, reported when the
   *  file is LEFT (og's close_altfile, edit.c:288), not at open. */
  preprocError?: string;
}

/**
 * Reports through the message line, queueing behind a pending message
 * like consecutive og error() calls.
 */
function report(message: string): void {
  if (search.message) {
    search.messageQueue.push(message);
  } else {
    search.message = message;
  }
}

/** Counts `%s` markers, like filename.c's num_pct_s. */
function pctS(text: string): number {
  let count = 0;

  for (let i = 0; i + 1 < text.length; i++) {
    if (text[i] === '%' && text[i + 1] === 's') count++;
  }

  return count;
}

/** Runs a preprocessor command through the shell, like og's shellcmd
 *  ($SHELL -c on unix, %COMSPEC% /c on Windows like og's popen); the
 *  pseudo-file's content feeds the child's stdin, like og letting
 *  the preprocessor inherit the input pipe. */
function shellCmd(cmd: string, input?: string): SpawnSyncReturns<string> {
  const argv = shellArgv(cmd);

  // og's popen child inherits stderr: a failing preprocessor's own
  // complaint ("cat: b: No such file or directory") reaches the
  // terminal before og's open error
  return spawnSync(argv[0], argv[1], {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'inherit'],
  });
}

/**
 * The failure message for a pipe preprocessor's exit, like edit.c's
 * close_pipe decoding the pclose status - null on clean exit.
 */
function preprocStatusMessage(
  result: SpawnSyncReturns<string>
): string | null {
  if (result.signal) {
    return `Input preprocessor terminated: ${result.signal}`;
  }

  const status = result.status ?? 0;
  if (status === 0) return null;

  if (status <= 128) {
    return `Input preprocessor failed (status ${status})`;
  }

  // shells add 128 to a fatal signal, like og assuming the tradition
  return `Input preprocessor terminated: signal ${status - 128}`;
}

/** Splits preprocessor output into display lines. */
const toLines = (data: string): string[] =>
  (data.endsWith('\n') ? data.slice(0, -1) : data).split('\n');

/**
 * Runs the $LESSOPEN preprocessor for a file being opened, like
 * filename.c's open_altfile.
 *
 * - `|cmd %s` pages the command's output; empty output means no
 *   replacement.
 * - `||cmd %s` distinguishes an empty replacement (exit 0) from no
 *   replacement (nonzero exit).
 * - `cmd %s` prints a replacement file name to page; $LESSCLOSE cleans
 *   it up later.
 *
 * @param filename - The file being opened.
 * @param input - The pseudo-file's content, fed to the preprocessor's
 *                stdin for the `-` forms, like og's inherited pipe.
 * @returns The replacement, or null to open the file itself.
 */
export function openAltFile(
  filename: string,
  input?: string
): AltFile | null {
  if (!secureAllow('lessopen')) return null;
  if (!optUseLessopen()) return null;

  let lessopen = process.env.LESSOPEN;
  if (!lessopen) return null;

  // leading pipes select the pipe preprocessor forms
  let pipes = 0;

  while (lessopen.startsWith('|')) {
    lessopen = lessopen.slice(1);
    pipes++;
  }

  // a "-" prefix lets the preprocessor accept standard input; without
  // it the pseudo-file keeps its in-memory lines, like og
  if (lessopen.startsWith('-')) {
    lessopen = lessopen.slice(1);
  } else if (filename === '-') {
    return null;
  }

  if (pctS(lessopen) !== 1) {
    report('LESSOPEN ignored: must contain exactly one %s');
    return null;
  }

  const cmd = lessopen.replace('%s', shellQuote(filename));
  const result = shellCmd(cmd, filename === '-' ? input : undefined);
  const output = result.stdout ?? '';

  if (pipes > 0) {
    if (!output) {
      // an abandoned pipe (no replacement) closes right here, so og
      // reports its status at open (close_pipe from the open path)
      if (optShowPreprocError()) {
        const message = preprocStatusMessage(result);
        if (message) report(message);
      }

      // with "||" a clean exit means the file really is empty, like
      // og's FAKE_EMPTYFILE; with "|" it means no replacement
      if (pipes > 1 && result.status === 0) {
        return { lines: [''], size: 0, alt: '-' };
      }

      return null;
    }

    // a USED replacement keeps its altpipe: og reports the exit
    // status only when the file is left (close_altfile, edit.c:288)
    return {
      lines: toLines(output),
      size: Buffer.byteLength(output),
      alt: '-',
      preprocError: preprocStatusMessage(result) ?? undefined,
    };
  }

  // the non-pipe form prints the replacement file's name
  const name = output.split('\n')[0];
  if (!name) return null;

  try {
    const data = fs.readFileSync(name, 'utf8');

    return { lines: toLines(data), size: fs.statSync(name).size, alt: name };
  } catch {
    report(`${name}: cannot open the LESSOPEN replacement`);
    return null;
  }
}

/**
 * Runs $LESSCLOSE when a preprocessed file is left, like filename.c's
 * close_altfile: the first %s is the original name, the second the
 * replacement.
 *
 * @param altName - The replacement name (`-` for pipes).
 * @param filename - The original file name.
 */
export function closeAltFile(
  altName: string,
  filename: string,
  preprocError?: string
): void {
  // og's close_altfile checks the altpipe status as the file is
  // left, the flag read at close time (a mid-session toggle counts);
  // error() gates INLINE - the message blocks on the current screen
  // and the interrupted action (help, quit, :n) continues after
  if (preprocError && optShowPreprocError()) gateReturn(preprocError);

  const lessclose = process.env.LESSCLOSE;
  if (!lessclose) return;

  if (pctS(lessclose) > 2) {
    report('LESSCLOSE ignored; must contain no more than 2 %s');
    return;
  }

  const cmd = lessclose
    .replace('%s', shellQuote(filename))
    .replace('%s', shellQuote(altName));

  shellCmd(cmd);
}
