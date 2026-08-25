import fs from 'fs';

import { secureAllow } from "./secure";


import { spawn, spawnSync, SpawnSyncReturns } from 'child_process';

import { Readable, Writable } from 'stream';

import { shellArgv } from '../tty/platform';

import { search } from "./searching";

import { shellQuote } from "./prompt";

import { optUseLessopen, optShowPreprocError } from "../options";

import { gateReturn } from "../tty/keyboard";

import { lgetenv } from '../startup/environment';

import { decodeContent } from './charset';

/** A $LESSOPEN replacement: its lines, byte size and alt file name. */
interface AltFile {
  lines: string[];
  size: number;
  /** `-` for pipe preprocessors, the temp file name otherwise. */
  alt: string;
  /** The preprocessor's output as it arrived, for the byte copy a
   *  non-terminal session makes (less's cat_file reads the altpipe
   *  through ch_forw_get, doing no line processing at all). */
  raw: string;
  /** The pipe preprocessor's failure message, reported when the
   *  file is LEFT (less's close_altfile, edit.c:288), not at open. */
  preprocError?: string;
}

/** What a cat session gets back: the alt name for $LESSCLOSE, plus a
 *  file to copy when the replacement is one. Nothing to copy means
 *  the bytes already went out (or the "||" form found it empty). */
interface AltStream {
  alt: string;
  path?: string;
  empty?: boolean;
  preprocError?: string;
}

/**
 * Reports through the message line, queueing behind a pending message
 * like consecutive less error() calls.
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

/** Runs a preprocessor command through the shell, like less's shellcmd
 *  ($SHELL -c on unix, %COMSPEC% /c on Windows like less's popen); the
 *  pseudo-file's content feeds the child's stdin, like less letting
 *  the preprocessor inherit the input pipe. */
function shellCmd(cmd: string, input?: string): SpawnSyncReturns<Buffer> {
  const argv = shellArgv(cmd);

  // less's popen child inherits stderr: a failing preprocessor's own
  // complaint ("cat: b: No such file or directory") reaches the
  // terminal before less's open error. The output stays BYTES: less's
  // cat_file copies the altpipe verbatim, so a decode here would
  // destroy every byte that is not valid UTF-8
  return spawnSync(argv[0], argv[1], {
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'inherit'],
  });
}

/**
 * The failure message for a pipe preprocessor's exit, like edit.c's
 * close_pipe decoding the pclose status - null on clean exit.
 */
function preprocStatusMessage(
  result: SpawnSyncReturns<Buffer>
): string | null {
  return exitMessage(result.status, result.signal);
}

/** The same decoding from a raw wait status. */
function exitMessage(
  code: number | null,
  signal: string | null
): string | null {
  if (signal) {
    return `Input preprocessor terminated: ${signal}`;
  }

  const status = code ?? 0;
  if (status === 0) return null;

  if (status <= 128) {
    return `Input preprocessor failed (status ${status})`;
  }

  // shells add 128 to a fatal signal, like less assuming the tradition
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
 *                stdin for the `-` forms, like less's inherited pipe.
 * @returns The replacement, or null to open the file itself.
 */
/** The command $LESSOPEN wants run for this file, and how many pipe
 *  characters selected the form, like the head of open_altfile. */
function resolveLessopen(
  filename: string
): { cmd: string, pipes: number } | null {
  if (!secureAllow('lessopen')) return null;

  // --no-shell means this session launches no processes at all, and a
  // preprocessor is a process: $LESSOPEN comes from the environment,
  // which a library call's embedding application does not own

  if (!optUseLessopen()) return null;

  let lessopen = lgetenv('LESSOPEN');
  if (!lessopen) return null;

  // leading pipes select the pipe preprocessor forms
  let pipes = 0;

  while (lessopen.startsWith('|')) {
    lessopen = lessopen.slice(1);
    pipes++;
  }

  // a "-" prefix lets the preprocessor accept standard input; without
  // it the pseudo-file keeps its in-memory lines, like less
  if (lessopen.startsWith('-')) {
    lessopen = lessopen.slice(1);
  } else if (filename === '-') {
    return null;
  }

  if (pctS(lessopen) !== 1) {
    report('LESSOPEN ignored: must contain exactly one %s');
    return null;
  }

  return { cmd: lessopen.replace('%s', shellQuote(filename)), pipes };
}

export function openAltFile(
  filename: string,
  input?: string
): AltFile | null {
  const resolved = resolveLessopen(filename);
  if (!resolved) return null;

  const { cmd, pipes } = resolved;
  const result = shellCmd(cmd, filename === '-' ? input : undefined);
  const bytes = result.stdout ?? Buffer.alloc(0);

  // through the charset, like every other input: a byte that is not
  // valid in it survives as a raw-byte marker for $LESSBINFMT, where
  // toString('utf8') would have replaced it with U+FFFD and less would
  // still be showing <FF>
  const output = decodeContent(bytes);

  // latin1 round-trips every byte, so a cat can write it back out
  // exactly as the preprocessor produced it
  const raw = bytes.toString('latin1');

  if (pipes > 0) {
    if (!output) {
      // an abandoned pipe (no replacement) closes right here, so less
      // reports its status at open (close_pipe from the open path)
      if (optShowPreprocError()) {
        const message = preprocStatusMessage(result);
        if (message) report(message);
      }

      // with "||" a clean exit means the file really is empty, like
      // less's FAKE_EMPTYFILE; with "|" it means no replacement
      if (pipes > 1 && result.status === 0) {
        return { lines: [''], size: 0, alt: '-', raw };
      }

      return null;
    }

    // a USED replacement keeps its altpipe: less reports the exit
    // status only when the file is left (close_altfile, edit.c:288)
    return {
      lines: toLines(output),
      // the pipe's OWN byte count: a marker is wider than the byte it
      // stands for, so the decoded string cannot be measured for this
      size: bytes.length,
      alt: '-',
      raw,
      preprocError: preprocStatusMessage(result) ?? undefined,
    };
  }

  // the non-pipe form prints the replacement file's name
  const name = output.split('\n')[0];
  if (!name) return null;

  try {
    const data = decodeContent(fs.readFileSync(name));

    return {
      lines: toLines(data),
      size: fs.statSync(name).size,
      alt: name,
      raw: data,
    };
  } catch {
    report(`${name}: cannot open the LESSOPEN replacement`);
    return null;
  }
}

/** The first data the pipe produces, or null when it produces none -
 *  less reads a single byte for this decision and ungets it. */
function firstChunk(stream: Readable): Promise<Buffer | null> {
  return new Promise(resolve => {
    const onData = (chunk: Buffer): void => {
      stream.pause();
      stream.off('end', onEnd);
      resolve(chunk);
    };

    const onEnd = (): void => {
      stream.off('data', onData);
      resolve(null);
    };

    stream.once('data', onData);
    stream.once('end', onEnd);
  });
}

/**
 * The $LESSOPEN pipe forms for a session that CATS its input.
 *
 * less keeps the popen stream open and reads through it as it copies
 * (open_altfile's returnfd branch hands edit_ifile the live FILE),
 * so the preprocessor is still running while its output is written -
 * which is why its own stderr lands interleaved rather than all in
 * front. Collecting the output first, as the display path must, gets
 * the bytes right and the order wrong, so this streams instead.
 *
 * The one-byte peek is less's: an empty pipe means no replacement, and
 * only then does the exit status decide between an EMPTY file (the
 * "||" form) and no alt file at all.
 *
 * @param filename - The file being opened.
 * @param out - Where the preprocessor's bytes go, verbatim.
 * @returns The replacement, or null to open the file itself.
 */
export async function streamAltFile(
  filename: string,
  out: Writable
): Promise<AltStream | null> {
  const resolved = resolveLessopen(filename);
  if (!resolved) return null;

  // only the pipe forms stream; "cmd %s" just names a file to open,
  // which the caller copies from disk like any other
  if (resolved.pipes === 0) {
    const alt = openAltFile(filename);
    return alt && { alt: alt.alt, path: alt.alt };
  }

  const argv = shellArgv(resolved.cmd);
  const child = spawn(argv[0], argv[1],
    { stdio: ['inherit', 'pipe', 'inherit'] });

  const first = await firstChunk(child.stdout);

  if (first !== null) out.write(first);
  if (first !== null) child.stdout.pipe(out, { end: false });

  const [status, signal] = await new Promise<[number | null, string | null]>(
    resolve => child.once('close', (code, sig) => resolve([code, sig]))
  );

  if (first === null) {
    // an abandoned pipe reports its status right here, like less's
    // close_pipe from the open path
    if (optShowPreprocError()) {
      const message = exitMessage(status, signal);
      if (message) report(message);
    }

    // with "||" a clean exit means the file really is empty, like
    // less's FAKE_EMPTYFILE; with "|" it means no replacement
    if (resolved.pipes > 1 && status === 0) return { alt: '-', empty: true };

    return null;
  }

  // a USED replacement keeps its altpipe: less reports the exit status
  // only when the file is left (close_altfile, edit.c:288)
  return {
    alt: '-',
    preprocError: exitMessage(status, signal) ?? undefined,
  };
}

/**
 * Runs $LESSCLOSE when a preprocessed file is left, like filename.c's
 * close_altfile: the first %s is the original name, the second the
 * replacement.
 *
 * @param altName - The replacement name (`-` for pipes).
 * @param filename - The original file name.
 */
export async function closeAltFile(
  altName: string,
  filename: string,
  preprocError?: string
): Promise<void> {
  // less's close_altfile checks the altpipe status as the file is
  // left, the flag read at close time (a mid-session toggle counts);
  // error() gates INLINE - the message blocks on the current screen
  // and the interrupted action (help, quit, :n) continues after
  if (preprocError && optShowPreprocError()) await gateReturn(preprocError);

  // the error report above is close_altpipe's, which less runs
  // unguarded; SF_LESSOPEN gates only LESSCLOSE, ahead of reading it
  // so a secure session stays silent about a malformed one
  if (!secureAllow('lessopen')) return;

  const lessclose = lgetenv('LESSCLOSE');
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
