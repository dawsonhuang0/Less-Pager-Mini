import fs from 'fs';
import { Readable } from 'stream';

import { lgetenv, screenFillGrace } from '../startup/environment';

import { keyboard } from '../tty/keyboard';

import { initInvocationOptions } from '../startup/invocation';

import { freshSession } from '../startup/freshSession';

import { search } from '../features/searching';

import {
  files,
  initContent,
  initFiles,
  loadFile,
  addExamineHistory,
  binaryConfirm,
  binFile,
} from '../features/files';

import { PipeDecoder } from '../features/charset';

import { pipeInput } from '../features/pipe';

import { checkModelines, hook, opt } from '../options';

import { inputToRawPaths } from '../helpers';

import { startupInit, printStartupError, warnReturn } from '../startup/startup';

import { printVersion } from '../features/misc';

import { contentPager } from './core';

import { BlockFile } from './blockFile';

import { FileInput } from './fileInput';

import { PipeSpool } from './spool';

/**
 * Pages non-seekable input. Acquiring and decoding the stream is isolated
 * here; the interactive behavior is the completed shared pager core.
 */
export async function pagerPipe(stream: Readable): Promise<void> {
  freshSession();
  initInvocationOptions();

  if (!keyboard().isTTY) {
    throw new Error('Less-pager-mini requires interactive terminal (TTY).');
  }

  // the pipe spools to a private temp file, becoming seekable: the
  // whole session then runs the same block-backed engine as a file,
  // with the upstream paused close to the view (og's ch buffers)
  const spool = await PipeSpool.create(stream);

  try {
    // og's initial read blocks until a screenful is seekable (or
    // LESS_SCREENFILL_TIME expires): a screen of newlines for short
    // lines, or a wrapped screen's worth of bytes for long ones
    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;

    while (!spool.ended && spool.size < rows * cols * 2 &&
           spooledNewlines(spool.path, rows) < rows &&
           screenFillGrace()) {
      spool.requestThrough(spool.size + 64 * 1024);
      await Promise.race([
        spool.waitForSettled(),
        new Promise(resolve => setTimeout(resolve, 50)),
      ]);
    }

    const bf = new BlockFile(spool.path);
    const head = bf.readRange(0, 64 * 1024);
    const decoder = new PipeDecoder();
    const lines = decoder.push(head);

    if (spool.ended && head.length >= spool.size) {
      lines.push(...decoder.flush());
    }
    if (!lines.length) lines.push('');

    initContent(lines);

    const entry = files.list[0];
    entry.size = spool.size;
    entry.sizeKnown = spool.ended;
    entry.streaming = !spool.ended;
    entry.everOpened = true;

    const input = new FileInput(bf, 0, spool);
    const prevScan = hook.scanFileSize;
    hook.scanFileSize = () => { spool.drain(); };

    try {
      await contentPager(lines, null, input);
    } finally {
      hook.scanFileSize = prevScan;
      input.close();
    }
  } finally {
    spool.close();
  }
}

/** Counts newlines already spooled, capped at the screenful asked for. */
function spooledNewlines(path: string, cap: number): number {
  let data: Buffer;
  try {
    data = fs.readFileSync(path);
  } catch {
    return 0;
  }

  let count = 0;
  for (let i = 0; i < data.length && count < cap; i++) {
    if (data[i] === 0x0A) count++;
  }
  return count;
}

/**
 * Pages seekable file input. File opening and incremental acquisition stay
 * here while options, commands, rendering and session lifecycle stay in core.
 */
export default async function streamPager(input: unknown): Promise<void> {
  freshSession();
  initInvocationOptions();

  if (!keyboard().isTTY) {
    throw new Error('Less-pager-mini requires interactive terminal (TTY).');
  }

  await filePager(inputToRawPaths(input));
}

async function filePager(filePaths: string[]): Promise<void> {
  if (!filePaths.length) return;

  const startup = startupInit([]);

  if (startup.version) {
    printVersion();
    return;
  }

  initFiles(filePaths);

  if (!lgetenv('LESSOPEN')) {
    const streamed = await blockFirstFile(startup);
    if (streamed) return;
  }

  for (let i = 0; i < files.list.length; i++) {
    let lines = loadFile(i);

    if (!lines && binaryConfirm.request) {
      binaryConfirm.request = false;
      process.stdout.write(
        `"${files.list[i].path}" may be a binary file.  See it anyway? `
      );

      const answer = await warnReturn();
      keyboard().setRawMode(false);
      keyboard().pause();
      process.stdout.write('\n');

      if (answer === 'y' || answer === 'Y') {
        files.list[i].everOpened = true;
        lines = loadFile(i);
      }
    }

    if (!lines && search.message) {
      printStartupError(search.message);
      search.message = '';
    }

    if (lines) {
      files.index = i;
      files.newFile = true;
      addExamineHistory(files.list[i].path);
      await contentPager(lines, startup);
      return;
    }
  }

  process.exitCode = 1;
}

async function blockFirstFile(
  startup: ReturnType<typeof startupInit>
): Promise<boolean> {
  const entry = files.list[0];

  let stat;
  try {
    stat = fs.statSync(entry.path);
  } catch {
    return false;
  }

  if (!stat.isFile()) return false;

  let bf: BlockFile;

  try {
    bf = new BlockFile(entry.path);
  } catch {
    return false;
  }

  const head = bf.readRange(0, 64 * 1024);
  const n = head.length;

  if (!opt.forceOpen && keyboard().isTTY && binFile(head)) {
    process.stdout.write(
      `"${entry.path}" may be a binary file.  See it anyway? `
    );

    const answer = await warnReturn();
    keyboard().setRawMode(false);
    keyboard().pause();
    process.stdout.write('\n');

    if (answer !== 'y' && answer !== 'Y') {
      bf.close();
      return true;
    }
  }

  entry.size = bf.size;
  entry.sizeKnown = true;
  entry.everOpened = true;

  const decoder = new PipeDecoder();
  const lines = decoder.push(head);
  const complete = n >= bf.size;

  if (complete) lines.push(...decoder.flush());
  if (!lines.length) lines.push('');

  checkModelines(lines);

  files.index = 0;
  files.newFile = true;
  addExamineHistory(entry.path);

  entry.streaming = false;
  const input = new FileInput(bf, 0);

  try {
    await contentPager(lines, startup, input);
  } finally {
    input.close();
    pipeInput.source = null;
    pipeInput.decoder = null;
  }

  return true;
}
