import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../src/config';

import { opt } from '../src/options';

import {
  session,
  resetSession,
  deriveContent,
  shellReserveLines
} from '../src/session';

const originalShellLines = process.env.LESS_SHELL_LINES;

beforeEach(() => {
  config.window = 24;
  opt.squeeze = 0;
  opt.tabStops = [];
  opt.tabDefault = 8;
  resetSession(['one', 'two']);
});

afterEach(() => {
  if (originalShellLines === undefined) {
    delete process.env.LESS_SHELL_LINES;
  } else {
    process.env.LESS_SHELL_LINES = originalShellLines;
  }
});

describe('session reset boundaries', () => {
  it('clears command, prompt, mouse, filter, and pipe state together', () => {
    const timer = setInterval(() => {}, 1000);
    const exit = (): void => {};
    const detach = (): void => {};
    const feed = (): void => {};

    Object.assign(session, {
      key: 'G',
      escCount: 9,
      buffer: ['1', '2'],
      pendingFirstCmds: ['G'],
      ungotStartKey: 'x',
      shellPause: 'pager',
      exited: true,
      exit,
      startupHelp: true,
      pasting: true,
      ignoringPaste: true,
      ignoreStart: 10,
      followTimer: timer,
      pendingEditWarn: true,
      userSeq: 'abc',
      lastClickY: 4,
      lastDragX: 5,
      lastDragY: 6,
      lastFilter: () => true,
      pipeStream: { fake: true },
      pipePaused: true,
      pipeDrainTo: exit,
      detachPipe: detach,
      pipeBudget: 1,
      pipeFirstFill: false,
      pipeProbing: true,
      fillKeys: ['x'],
      pipeWaiting: true,
      intrPending: true,
      feedKeys: feed,
    });

    const content = ['fresh'];
    resetSession(content);
    clearInterval(timer);

    expect(session.content).toBe(content);
    expect(session.fullContent).toBe(content);
    expect(session.prevContent).toBe(content);
    expect(session.prevConfig).toBe(config);
    expect(session.prevMode).toBe(mode);
    expect({
      key: session.key,
      escCount: session.escCount,
      buffer: session.buffer,
      pendingFirstCmds: session.pendingFirstCmds,
      ungotStartKey: session.ungotStartKey,
      shellPause: session.shellPause,
      exited: session.exited,
      startupHelp: session.startupHelp,
      pasting: session.pasting,
      ignoringPaste: session.ignoringPaste,
      ignoreStart: session.ignoreStart,
      followTimer: session.followTimer,
      pendingEditWarn: session.pendingEditWarn,
      userSeq: session.userSeq,
      lastClickY: session.lastClickY,
      lastDragX: session.lastDragX,
      lastDragY: session.lastDragY,
      lastFilter: session.lastFilter,
      pipeStream: session.pipeStream,
      pipePaused: session.pipePaused,
      pipeDrainTo: session.pipeDrainTo,
      pipeBudget: session.pipeBudget,
      pipeFirstFill: session.pipeFirstFill,
      pipeProbing: session.pipeProbing,
      fillKeys: session.fillKeys,
      pipeWaiting: session.pipeWaiting,
      intrPending: session.intrPending,
    }).toEqual({
      key: '',
      escCount: 0,
      buffer: [],
      pendingFirstCmds: [],
      ungotStartKey: '',
      shellPause: false,
      exited: false,
      startupHelp: false,
      pasting: false,
      ignoringPaste: false,
      ignoreStart: 0,
      followTimer: null,
      pendingEditWarn: false,
      userSeq: '',
      lastClickY: -1,
      lastDragX: -1,
      lastDragY: -1,
      lastFilter: null,
      pipeStream: null,
      pipePaused: false,
      pipeDrainTo: null,
      pipeBudget: Infinity,
      pipeFirstFill: true,
      pipeProbing: false,
      fillKeys: [],
      pipeWaiting: false,
      intrPending: false,
    });

    expect(session.detachPipe).not.toBe(detach);
    expect(session.feedKeys).not.toBe(feed);
    expect(session.exit).not.toBe(exit);
    expect(session.processTitle).toBe(process.title);
  });
});

describe('derived content', () => {
  it('runs the display transform without a filter', () => {
    opt.squeeze = 1;
    session.fullContent = ['a', '', '', 'b'];

    expect(deriveContent()).toEqual(['a', '', 'b']);
  });

  it('filters raw lines before applying display transforms', () => {
    opt.squeeze = 1;
    session.fullContent = ['keep', '', '', 'drop', 'also keep'];
    session.lastFilter = line => line !== 'drop';

    expect(deriveContent()).toEqual(['keep', '', 'also keep']);
    expect(session.lastFilter).not.toBe(null);
  });

  it('keeps an empty successful filter distinct from a dropped filter', () => {
    session.fullContent = ['one', 'two'];
    session.lastFilter = () => false;

    expect(deriveContent()).toEqual([]);
    expect(session.lastFilter).not.toBe(null);
  });
});

describe('$LESS_SHELL_LINES clamping', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['garbage', 0],
    ['-5', -5],
    ['4', 4],
    ['999', 23],
  ])('maps %j to %d reserved rows', (value, expected) => {
    if (value === undefined) delete process.env.LESS_SHELL_LINES;
    else process.env.LESS_SHELL_LINES = value;

    expect(shellReserveLines()).toBe(expected);
  });

  it('clamps to zero rows on a one-line terminal', () => {
    config.window = 1;
    process.env.LESS_SHELL_LINES = '99';

    expect(shellReserveLines()).toBe(0);
  });
});
