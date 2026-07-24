import fs from 'fs';
import { Readable } from 'stream';

import { lgetenv } from '../environment';

import { keyboard } from '../keyboard';

import { initInvocationOptions } from '../invocation';

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

import { checkModelines, opt } from '../options';

import { inputToRawPaths } from '../helpers';

import { startupInit, printStartupError, warnReturn } from '../startup';

import { printVersion } from '../features/misc';

import { contentPager } from './core';

import { BlockFile } from './blockFile';

import { FileInput } from './fileInput';

/**
 * Pages non-seekable input. Acquiring and decoding the stream is isolated
 * here; the interactive behavior is the completed shared pager core.
 */
export async function pagerPipe(stream: Readable): Promise<void> {
  initInvocationOptions();

  if (!keyboard().isTTY) {
    throw new Error('Less-pager-mini requires interactive terminal (TTY).');
  }

  const decoder = new PipeDecoder();

  const first = await new Promise<{ lines: string[], ended: boolean }>(
    resolve => {
      const onData = (chunk: Buffer): void => {
        stream.off('end', onEnd);
        stream.pause();
        resolve({ lines: decoder.push(chunk), ended: false });
      };

      const onEnd = (): void => {
        stream.off('data', onData);
        resolve({ lines: decoder.flush(), ended: true });
      };

      stream.once('data', onData);
      stream.once('end', onEnd);
    }
  );

  const lines = first.lines;
  if (first.ended && !lines.length) lines.push('');

  initContent(lines);

  if (!first.ended) {
    files.list[0].streaming = true;
    pipeInput.source = stream;
    pipeInput.decoder = decoder;
  }

  try {
    await contentPager(lines);
  } finally {
    pipeInput.source = null;
    pipeInput.decoder = null;
  }
}

/**
 * Pages seekable file input. File opening and incremental acquisition stay
 * here while options, commands, rendering and session lifecycle stay in core.
 */
export default async function streamPager(input: unknown): Promise<void> {
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
