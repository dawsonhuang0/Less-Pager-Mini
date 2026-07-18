import fs from 'fs';

import { spawnSync } from 'child_process';

import { keyboard, closeTtyKeyboard, consumeInterrupt, takeUngot,
  watchWinch, unwatchWinch, freshWindowSize }
  from '../keyboard';

import { help } from '../lessHelp';

import { transformContent } from '../lines/helpers';

import { ringBell } from '../helpers';

import { versionMessage } from '../features/misc';

import { BlockFile } from './ch';
import { BigView, displayText } from './screen';

import { getLayout, emitRow } from '../lines/lineLayout';

import { config } from '../config';

import { getAction, splitKeys } from '../keys';

import { forwLine, backLine } from './lineio';

import { search, searchInterrupted } from '../features/searching';

import { displayPrType, optIntrChar, prChar } from '../options/shared';

import { scanOptions, chopLine, onTrimBufSpace, takeCliOptions,
  flushPendopt, applyMouse, applyBracketedPaste, hook, opt,
  option, startOption, optionKey, gutterWidth, optWheelLines,
  optMouseReverse, optTildes }
  from '../options';

import {
  cmd,
  cmdOpen,
  cmdClose,
  cmdChar,
  cmdUngot,
  cmdText,
  cmdDisplay
} from '../features/cmdbuf';

import {
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF,
  KEYPAD_ON,
  KEYPAD_OFF,
  MOUSE_OFF,
  MOUSE_SGR_OFF,
  BRACKETED_PASTE_OFF,
  CLEAR_LINE,
  CLEAR_BELOW,
  CURSOR_HOME,
  SYNC_ON,
  SCROLL_UP_REGEX,
  SCROLL_DOWN_REGEX,
  SYNC_OFF,
  INVERSE_ON,
  INVERSE_OFF
} from '../constants';

/**
 * The file-backed pager session for huge files, mirroring og's real
 * architecture: a BigView position drives the screen and every frame
 * materializes only the visible lines. Feature parity grows toward
 * the in-memory session; movement, jumps and percent work today.
 */

/** Files at or above this size take the windowed path (128MB). */
export const BIG_FILE_THRESHOLD = 128 * 1024 * 1024;

export async function bigPager(path: string): Promise<void> {
  const bf = new BlockFile(path);

  // a fresh file starts with no known biggest line number
  opt.linenumDigits = 0;
  const view = new BigView(bf);

  // a -b toggle trims the block pool at once, like ch_setbufspace
  onTrimBufSpace(() => bf.trim());

  // og's opt_filesize scans only when ch_length() == NULL_POSITION;
  // a seekable file's length is always known, so the toggle only
  // reports (the regular session's pipe hook is restored at exit)
  const prevScanFileSize = hook.scanFileSize;
  hook.scanFileSize = () => {};

  // $LESS applies here too, then the lmn command line options
  scanOptions(process.env.LESS ?? '', []);
  for (const arg of takeCliOptions()) scanOptions(arg, [], false);
  flushPendopt();

  keyboard().setRawMode(true);
  keyboard().resume();

  config.window = process.stdout.rows || 24;
  config.screenWidth = process.stdout.columns || 80;

  let buffer: string[] = [];
  let first = true;

  // streaming search state, like og search.c over ch positions
  let searching: '/' | '?' | '' = '';
  let pattern: RegExp | null = null;
  let lastDir: 1 | -1 = 1;
  let message = '';

  const searchHistory: string[] = [];

  // marks and the quote mark, like og mark.c over POSITIONs
  const marks = new Map<string, { pos: number, subRow: number }>();
  let quoteMark: { pos: number, subRow: number } | null = null;
  let marking: 'm' | 'M' | "'" | 'c' | '' = '';

  // the : command prefix collecting its second char, like og's mca
  let coloning = false;

  // the ! / # shell prompt and its post-command pause, like lsystem
  let shelling: '!' | '#' | '' = '';
  let shellPausing = false;

  // the h help overlay: og pages FAKE_HELPFILE through the pager
  let helpTop = -1;
  let helpLines: string[] = [];

  // og's linenum anchors (add_lnum): positions with known newline
  // counts, cached as scans walk so later ones resume nearby
  const lnums: { pos: number, num: number }[] = [{ pos: 0, num: 0 }];
  // a "(press RETURN)" message is pending: RETURN dismisses it, any
  // other key ungets as the next command, like og's get_return
  let msgReturn = false;
  // a second queued error shows after the first dismisses, like
  // og's errmsgs chain
  let msgNext = '';
  // true when the last countTo displayed the delayed message before
  // aborting: og's abort_delayed_msg acts only then (loopcount < 0)
  let scanMessaged = false;
  // og's pending S_INTERRUPT: psignals runs getcc_clear at the top
  // of the command loop, so keys captured at a gate after an
  // interrupt-abort are discarded; fresh keys act normally
  let intrPending = false;
  // a WINCH during a blocking scan is queued, not live: og's intio
  // longjmps only while blocked reading the tty, so the scan's
  // message survives — the queued signal repaints at psignals only
  // after a real key dismisses it
  let winchGuard = false;

  /**
   * Newlines before `target`, like find_linenum walking raw lines
   * from the nearest anchor: og shows "Calculating line numbers"
   * after LONGTIME (2s) and ^X or interrupt aborts (returns null).
   * The open-time scan_eof passes its own "Determining length of
   * file" wording instead (linenum.c detlenmessage).
   */
  const countTo = (
    target: number,
    note: string = 'Calculating line numbers'
  ): number | null => {
    let anchor = lnums[0];
    for (const a of lnums) {
      if (a.pos <= target && a.pos > anchor.pos) anchor = a;
    }

    let { pos, num } = anchor;
    const started = Date.now();
    let messaged = false;
    let steps = 0;
    scanMessaged = false;

    while (pos < target) {
      const chunk = bf.readRange(pos, Math.min(65536, target - pos));
      if (!chunk.length) break;

      for (let i = chunk.indexOf(10); i >= 0; i = chunk.indexOf(10, i + 1)) {
        num++;
      }

      pos += chunk.length;

      if ((++steps & 15) === 0) {
        lnums.push({ pos, num });

        if (!messaged && Date.now() - started >= 2000) {
          messaged = true;
          scanMessaged = true;
          // a stream write queues behind the blocking scan and would
          // only flush with the result; og's ierror ends in flush()
          fs.writeSync(1, '\r' + CLEAR_LINE + INVERSE_ON +
            note + '... (interrupt to abort)' + INVERSE_OFF);
        }

        if (searchInterrupted()) {
          // the aborting ^C is og's consumed signal, never a key;
          // the pending S_INTERRUPT clears the next gate's key too
          consumeInterrupt();
          intrPending = true;
          if (Date.now() - started > 100) winchGuard = true;
          return null;
        }
      }
    }

    lnums.push({ pos: target, num });
    // the biggest number seen widens the uniform gutter (og's field
    // is a per-row minimum the digits overflow)
    opt.linenumDigits = Math.max(opt.linenumDigits, String(num + 1).length);
    // a resize during this blocking walk arrives queued, not live
    if (Date.now() - started > 100) winchGuard = true;
    return num;
  };

  // --file-size scans the whole file before the screen initializes,
  // like edit() calling scan_eof unconditionally: og pages only
  // after the length and line count are known, with "Determining
  // length of file" on the main screen once the scan runs long
  let gateKey = '';

  if (opt.wantFileSize > 0) {
    const scanned = countTo(Math.max(bf.size - 1, 0),
      'Determining length of file');
    // og clears its ierror line before the alt screen enters
    if (scanMessaged) fs.writeSync(1, '\r' + CLEAR_LINE);

    // the aborting ^C is og's consumed signal, never a key
    if (scanned === null) consumeInterrupt();


    // an interrupt after the message showed turns line numbers off
    // (abort_delayed_msg): the pre-init error prints plainly and
    // gates on RETURN before the screen, like og's errmsgs check
    // (main.c:457) — get_return ungets any other key as the first
    // command
    if (scanned === null && scanMessaged) {
      opt.linenums = 0;
      fs.writeSync(1,
        'Line numbers turned off\nPress RETURN to continue ');

      const answer = await new Promise<string>(resolve => {
        const onGateKey = (data: Buffer): void => {
          unwatchWinch(onGateWinch);

          // one char gates; the rest stays buffered as input
          if (data.length > 1) {
            keyboard().pause();
            keyboard().unshift(data.subarray(1));
          }

          resolve(data.toString()[0] ?? '');
        };

        // og's lwinch interrupts get_return: a resize passes the
        // gate with no key
        const onGateWinch = (): void => {
          unwatchWinch(onGateWinch);
          keyboard().off('data', onGateKey);
          resolve('');
        };

        keyboard().once('data', onGateKey);
        watchWinch(onGateWinch);
      });

      fs.writeSync(1, '\n');
      keyboard().resume();

      // ^C is og's READ_INTR at get_return: swallowed, not ungot
      if (answer !== '\x0D' && answer !== '\x0A' && answer !== ' ' &&
          answer !== '\x03') {
        gateKey = answer;
      }

      // the pending S_INTERRUPT: psignals' getcc_clear at the top
      // of og's command loop discards the gate's ungot key
      if (intrPending) {
        intrPending = false;
        gateKey = '';
        consumeInterrupt();
      }
    }
  }

  // a resize during the open scan arrived before any winch listener
  // existed: og's psignals runs update_term before the first paint,
  // so re-measure like scrsize
  {
    const fresh = freshWindowSize();
    if (fresh) {
      config.window = fresh[1] || config.window;
      config.screenWidth = fresh[0] || config.screenWidth;
    }
  }

  process.stdout.write(ALTERNATE_CONSOLE_ON + KEYPAD_ON);

  // mouse tracking and bracketed paste enable with the screen
  hook.screenActive = true;
  applyMouse();
  applyBracketedPaste();

  // F follow state, like og's forw_loop
  let following = false;
  let followQueue: string[] = [];
  let followTimer: ReturnType<typeof setInterval> | null = null;

  /** Records the pre-jump position into the quote mark, like lastmark. */
  const remember = (): void => {
    quoteMark = { ...view.top };
  };

  /**
   * = and :f build og's eq_message: lines %lt-%lb/%L needs line
   * numbers (a whole-file scan, delayed message + abort); byte %bB
   * is BOTTOM_PLUS_ONE with its percent.
   */
  const showInfo = (): void => {
    // og's cmd_exec clear_bots before the command runs: the prompt
    // line blanks at once, even while the line scan takes seconds
    fs.writeSync(1, '\r' + CLEAR_LINE);

    const { rows, endPos } = view.visible(config.window - 1);
    const pct = bf.size
      ? Math.floor((endPos * 100) / bf.size)
      : 100;

    // -n (and a previously aborted scan) skips line numbers
    // entirely, like find_linenum's !linenums early return
    const topNum = opt.linenums === 0
      ? null
      : countTo(view.top.pos);
    const botNum = topNum === null || !rows.length
      ? null
      : countTo(rows[rows.length - 1].pos);
    const total = botNum === null
      ? null
      : countTo(Math.max(bf.size - 1, 0));

    // an aborted scan leaves later fields unknown: og renders "?"
    // for each (lines 1-23/? when only the total scan aborted) and
    // drops the segment only when the top line itself is unknown
    // (?lt); if the delayed message had shown, og turns line
    // numbers off for good and says so (abort_delayed_msg), the eq
    // info queuing behind
    const aborted = opt.linenums !== 0 &&
      (topNum === null || botNum === null || total === null);
    const lines = topNum === null
      ? ''
      : `lines ${topNum + 1}-` +
        `${botNum === null ? '?' : botNum + 1}/` +
        `${total === null ? '?' : total + 1} `;

    const eq =
      `${path} ${lines}byte ${endPos}/${bf.size} ${pct}%` +
      '  (press RETURN)';

    if (aborted && scanMessaged) {
      opt.linenums = 0;
      message = 'Line numbers turned off  (press RETURN)';
      msgNext = eq;
    } else {
      message = eq;
    }

    msgReturn = true;
  };

  /**
   * Streams the file line by line for the pattern, like og's search
   * walking ch buffers; ^X interrupts via the tty poll.
   */
  const runSearch = (dir: 1 | -1, fromTop: number): boolean => {
    if (!pattern) return false;

    // og's exec_mca starts with cmd_exec(): clear_bot + flush wipe
    // the /pattern line BEFORE the search runs (command.c:267), so
    // a long walk shows a blank command line; the write is sync —
    // a stream write would defer behind the blocking loop
    fs.writeSync(1, `\x1b[${config.window};1H` + CLEAR_LINE);

    let steps = 0;

    if (dir > 0) {
      let pos = forwLine(bf, fromTop)?.next ?? bf.size;

      while (pos < bf.size) {
        const line = forwLine(bf, pos);
        if (!line) break;

        if (pattern.test(line.text)) {
          view.top = { pos, subRow: 0 };
          return true;
        }

        pos = line.next;

        if (++steps % 5000 === 0 && searchInterrupted()) {
          message = 'Search interrupted';
          return false;
        }
      }
    } else {
      let pos = fromTop;

      for (;;) {
        const prev = backLine(bf, pos);
        if (!prev) break;

        if (pattern.test(prev.text)) {
          view.top = { pos: prev.start, subRow: 0 };
          return true;
        }

        pos = prev.start;

        if (++steps % 5000 === 0 && searchInterrupted()) {
          message = 'Search interrupted';
          return false;
        }
      }
    }

    message = `Pattern not found: ${cmdText() || '(previous)'}`;
    return false;
  };

  const draw = (): void => {
    // -N and -J reserve gutter columns inside the width, like og's
    // line prefix (line.c pfx); recompute per frame so toggles apply
    config.screenWidth = (process.stdout.columns || 80) - gutterWidth();

    // the h help overlay pages og's FAKE_HELPFILE with its prompts
    if (helpTop >= 0) {
      const count = config.window - 1;
      const slice = helpLines.slice(helpTop, helpTop + count);
      // og's gline pads null lines by the -~ twiddle, bold like
      // AT_BOLD (blank rows when --tilde is off)
      while (slice.length < count) {
        slice.push(optTildes() ? '\x1b[1m~\x1b[m' : '');
      }

      const hPrompt = helpTop + count >= helpLines.length
        ? 'HELP -- END -- Press g to see it again, or q when done '
        : 'HELP -- Press RETURN for more, or q when done ';

      const body = slice.map(r => CLEAR_LINE + r).join('\n');
      process.stdout.write(
        SYNC_ON + CURSOR_HOME + body + '\n' + CLEAR_LINE +
        INVERSE_ON + hPrompt + INVERSE_OFF + CLEAR_BELOW + SYNC_OFF
      );
      return;
    }

    const count = config.window - 1;
    const { rows } = view.visible(count);

    const display: string[] = [];

    for (const row of rows) {
      const text = displayText(row.text);
      let out: string;

      if (chopLine() || config.col) {
        // chop: the layout's first row is exactly one screen width
        out = emitRow(getLayout(text), 0);
      } else {
        // each screen row is self-contained like og's at_switch: a
        // spanning style reopens at the row start and closes at its
        // end, keeping the next row's gutter clean
        const lay = getLayout(text);
        out = (row.subRow > 0 ? lay.rowStyle[row.subRow] ?? '' : '') +
          emitRow(lay, row.subRow);

        if (lay.rowStyle[row.subRow + 1]) out += '\x1b[0m';
      }

      // og's line prefix: the -J mark letter, then the -N number
      // right-aligned in linenum_width + a space, bold like AT_BOLD.
      // EVERY row of a wrapped line repeats the prefix — og builds
      // it from the line's base_pos (forw_line_seg -> plinestart,
      // input.c:149); only unknown numbers stay blank
      let pfx = '';

      if (opt.statusCol) {
        let mark = ' ';
        for (const [letter, m] of marks) {
          if (m.pos === row.pos) { mark = letter; break; }
        }
        pfx += mark.padEnd(opt.statusColWidth);
      }

      if (opt.linenums === 2) {
        const num = countTo(row.pos);

        if (num === null) {
          pfx += ' '.repeat(Math.max(opt.linenumWidth, opt.linenumDigits) + 1);

          // an interrupted count is og's abort_delayed_msg: line
          // numbers turn off for good and the error reports it
          if (scanMessaged) {
            opt.linenums = 0;
            message = 'Line numbers turned off  (press RETURN)';
            msgReturn = true;
          }
        } else {
          // og pads with AT_NORMAL spaces and bolds only the digits
          const digits = String(num + 1);
          pfx += ' '.repeat(
            Math.max(Math.max(opt.linenumWidth, opt.linenumDigits) -
              digits.length, 0)) +
            '\x1b[1m' + digits + '\x1b[m ';
        }
      }

      out = pfx + out;

      // highlight search matches in view, like og's hilites
      if (pattern && search.highlight) {
        const global = new RegExp(pattern.source,
          pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
        out = out.replace(global,
          m => (m ? INVERSE_ON + m + INVERSE_OFF : m));
      }

      display.push(out);
    }

    // og's gline pads null lines by the -~ twiddle, bold like
    // AT_BOLD (blank rows when --tilde is off)
    while (display.length < count) {
      display.push(optTildes() ? '\x1b[1m~\x1b[m' : '');
    }

    const percent = bf.size
      ? Math.floor((view.top.pos * 100) / bf.size)
      : 100;
    const name = first ? `${path} ` : '';

    // og prompt styles: short shows ':', -m percent, -M the works
    const base = displayPrType() === 2
      ? `${path} byte ${view.top.pos}/${bf.size} ${percent}%`
      : displayPrType() === 1
        ? `${percent}%`
        : ':';

    // the - prompt echoes like og's mca_opt: the doubled dash for a
    // long name, (P)/flag marks, a spec's parameter prompt
    const optPrompt = !option.pending
      ? ''
      : option.spec
        ? (option.spec.prompt ?? '') +
          (cmd.active ? cmdDisplay() : option.param)
        : option.name !== null
          ? option.pending + option.pending +
            (option.noPrompt ? '(P)' : '') + option.flag +
            (cmd.active ? cmdDisplay() : option.name)
          : option.pending + (option.noPrompt ? '(P)' : '') + option.flag;

    const prompt = resolvingBlank
      ? ''
      : coloning
      ? ' :'
      : option.pending
      ? optPrompt
      : searching
      ? searching + cmdDisplay()
      : shelling
      ? shelling + cmdDisplay()
      : marking
        ? (marking === 'm' ? 'set mark: '
          : marking === 'M' ? 'set mark bottom: '
          : marking === 'c' ? 'clear mark: '
          : 'goto mark: ')
        : following
          ? INVERSE_ON + 'Waiting for data... (' +
            `${prChar(optIntrChar())} or interrupt to abort)` + INVERSE_OFF
          : message
            ? `${INVERSE_ON}${message}${INVERSE_OFF}`
            : view.atEof
              ? `${INVERSE_ON}${name}(END)${INVERSE_OFF}`
              : first
                ? `${INVERSE_ON}${name}${INVERSE_OFF}`
                : displayPrType() === 0
                  ? base
                  : `${INVERSE_ON}${base}${INVERSE_OFF}`;

    const body = display.map(r => CLEAR_LINE + r).join('\n');
    process.stdout.write(
      SYNC_ON + CURSOR_HOME + body + '\n' + CLEAR_LINE + prompt +
      CLEAR_BELOW + SYNC_OFF
    );
  };

  /** ! and # run through the shell, like og's lsystem. */
  const runShellCmd = (bang: '!' | '#', text: string): void => {
    // og's fexpand: % is the current file name
    const expanded = text.replace(/%/g, path);

    // lsystem echoes the command and deinits the screen
    process.stdout.write('\r' + CLEAR_LINE + bang + expanded + '\n');
    process.stdout.write(KEYPAD_OFF + ALTERNATE_CONSOLE_OFF);
    keyboard().setRawMode(false);
    keyboard().pause();

    const shell = process.env.SHELL || 'sh';
    spawnSync(shell, expanded ? ['-c', expanded] : [],
      { stdio: 'inherit' });

    keyboard().setRawMode(true);
    keyboard().resume();

    // the done message waits on the shell screen, like og
    process.stdout.write(`${bang}done  (press RETURN)`);
    shellPausing = true;
  };

  /** v spawns the editor at the current line, like og's %E +%lm %g. */
  const runEditor = (): void => {
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    // og's cmd_exec clear_bot, then currline(TOP) — the line
    // number may need the scan
    fs.writeSync(1, '\r' + CLEAR_LINE);
    const line = countTo(view.top.pos);

    process.stdout.write(KEYPAD_OFF + ALTERNATE_CONSOLE_OFF);
    keyboard().setRawMode(false);
    keyboard().pause();

    spawnSync(editor, line === null ? [path] : [`+${line + 1}`, path],
      { stdio: 'inherit' });

    keyboard().setRawMode(true);
    keyboard().resume();
    process.stdout.write(ALTERNATE_CONSOLE_ON + KEYPAD_ON);
    bf.refreshSize();
  };

  // the view position of the previous resolveBottom, so only real
  // movements walk the line count
  let lastResolved = '';

  // og's cleared command line while currline(BOTTOM) walks
  let resolvingBlank = false;

  /**
   * og ends EVERY forw() and back() with `(void) currline(BOTTOM)`
   * (forwback.c:382,457): the bottom line's number resolves
   * eagerly, walking the file from the nearest anchor with the
   * delayed "Calculating line numbers" message — G on a huge file
   * scans it all, whatever the -n/-N display state; only -n's
   * linenums==0 suppresses it (find_linenum, linenum.c:278). The
   * prompt paints only AFTER the walk: og's command line stays
   * blank (cmd_exec's clear) for the duration, so (END) waits.
   * An interrupt past the delayed message is abort_delayed_msg:
   * line numbers turn off with the gated error.
   */
  const resolveBottom = (): void => {
    if (opt.linenums === 0) return;

    const at = view.top.pos + ':' + view.top.subRow;
    if (at === lastResolved) return;
    lastResolved = at;

    // a walk far from every anchor can run long: show og's blank
    // command line first so the prompt doesn't precede the count
    let near = 0;
    for (const a of lnums) {
      if (a.pos <= view.top.pos && a.pos > near) near = a.pos;
    }

    const far = view.top.pos - near > 64 * 1024 * 1024;
    if (far) {
      resolvingBlank = true;
      draw();
      resolvingBlank = false;
    }

    if (countTo(view.top.pos) === null && scanMessaged) {
      // og's abort_delayed_msg (linenum.c:254): numbers off, the
      // gated message; the repaint drops any -N gutter
      opt.linenums = 0;
      message = 'Line numbers turned off  (press RETURN)';
      msgReturn = true;
    }
  };

  /** Ends F follow mode, discarding the queued keys (getcc_clear:
   *  every bigfile exit is og's READ_INTR path). */
  const endFollow = (): void => {
    following = false;
    if (followTimer) clearInterval(followTimer);
    followTimer = null;
    followQueue = [];
  };

  await new Promise<void>(resolve => {
    let done = false;

    /** Repaints for the new terminal size, like og's winch(). */
    const onResize = (): void => {
      // og's update_term re-runs scrsize itself: node's cached
      // winsize lags both blocked loops and raw SIGWINCH handlers
      const size = freshWindowSize();
      config.window = (size ? size[1] : process.stdout.rows) || 24;
      config.screenWidth =
        (size ? size[0] : process.stdout.columns) || 80;

      // a WINCH queued during a blocking scan never reached og's
      // get_return: the message it produced stays waiting on the
      // old screen, the repaint deferred to psignals after a real
      // key dismisses it (og paints nothing here)
      if (winchGuard) {
        winchGuard = false;
        if (msgReturn) return;
      }

      // og's lwinch longjmps out of get_return like an interrupt: a
      // resize dismisses a waiting message without a key (and
      // without getcc_clear — WINCH is not an abort signal); the
      // errmsgs chain's next message then takes its own turn
      if (msgReturn) {
        msgReturn = false;
        message = '';

        if (msgNext) {
          message = msgNext;
          msgNext = '';
          msgReturn = true;
        }
      }

      draw();
    };

    /** The one exit path: every listener leaves with the session. */
    const quit = (): void => {
      if (done) return;
      done = true;

      if (followTimer) clearInterval(followTimer);
      keyboard().off('data', onKey);
      process.off('SIGTERM', quit);
      process.off('SIGHUP', quit);
      unwatchWinch(onResize);
      resolve();
    };

    const onKey = (data: Buffer): void => {
      for (const key of splitKeys(data.toString())) {
        first = false;

        // og clears the pending S_INTERRUPT at the top of the next
        // command iteration (psignals): only a blocking message's
        // dismissing key is subject to its getcc_clear — a silent
        // abort's flag never outlives the loop resuming
        if (intrPending && !msgReturn) intrPending = false;

        // a real key means og was blocked at the tty again: any
        // WINCH from here on is live, not scan-queued
        winchGuard = false;

        // og's get_return after an error: RETURN dismisses, any
        // other key falls through as the next command (ungetcc);
        // a queued second error shows next, like og's errmsgs chain
        if (msgReturn) {
          msgReturn = false;
          message = '';

          // og's get_return reads the raw tty (never the ungot
          // queue), so EVERY message in the errmsgs chain captures
          // its own dismissing key; the pending S_INTERRUPT's
          // getcc_clear at the loop top then discards them ALL —
          // only a key after the chain (and the psignals clear)
          // acts as a command
          const discarded = intrPending;

          if (msgNext) {
            message = msgNext;
            msgNext = '';
            msgReturn = true;
            draw();
            continue;
          }

          if (intrPending) {
            intrPending = false;
            consumeInterrupt();
          }

          if (discarded || key === '\x0D' || key === '\x0A') {
            draw();
            continue;
          }
        }

        message = '';

        // F wait: ^C / --intr return to paging; other keys queue like
        // og's read poll ungetting them — but an interrupt exit runs
        // getcc_clear (os.c iread / psignals), so they are discarded
        if (following) {
          if (key === '\x03' || key === optIntrChar()) {
            // ^C is og's SIGINT: u_interrupt rings; --intr is silent
            if (key === '\x03') process.stdout.write('\x07');

            endFollow();
            draw();
          } else {
            followQueue.push(key);
          }
          continue;
        }

        // single-char mark prompts (m / ')
        if (marking) {
          const kind = marking;
          marking = '';

          if (!(key === '\x03' || key.startsWith('\x1B'))) {
            if (kind === 'm' || kind === 'M') {
              if (/^[a-zA-Z#]$/.test(key[0])) {
                // M marks the bottom displayed line, like og's
                // setmark with the BOTTOM position
                const pos = kind === 'M'
                  ? (() => {
                      const { rows } = view.visible(config.window - 1);
                      const last = rows[rows.length - 1];
                      return last
                        ? { pos: last.pos, subRow: last.subRow }
                        : { ...view.top };
                    })()
                  : { ...view.top };
                marks.set(key[0], pos);
              } else {
                message = `Invalid mark letter ${key[0]}`;
              }
            } else if (kind === 'c') {
              // ESC-m clears a mark, erroring like og's getumark
              if (marks.has(key[0])) marks.delete(key[0]);
              else {
                message = /^[a-zA-Z#]$/.test(key[0])
                  ? 'Mark not set'
                  : `Invalid mark letter ${key[0]}`;
              }
            } else {
              const target = key[0] === "'" || key === '\x18'
                ? quoteMark
                : key[0] === '^' ? { pos: 0, subRow: 0 }
                : key[0] === '$' ? null
                : marks.get(key[0]) ?? undefined;

              if (key[0] === '$') {
                remember();
                view.gotoEnd(config.window);
              } else if (target === undefined) {
                message = /^[a-zA-Z#]$/.test(key[0])
                  ? 'Mark not set'
                  : `Invalid mark letter ${key[0]}`;
              } else if (target) {
                remember();
                view.top = { ...target };
              }
            }
          }

          draw();
          continue;
        }

        // the h help overlay owns the keys until q, like og's help
        if (helpTop >= 0) {
          const count = config.window - 1;
          const cap = Math.max(helpLines.length - count, 0);
          const atEnd = helpTop + count >= helpLines.length;

          if (key === 'q' || key === 'Q' ||
              (atEnd && (key === '\x0D' || key === '\x0A'))) {
            helpTop = -1;
          } else {
            switch (getAction(key)) {
              case 'LINE_FORWARD':
                helpTop = Math.min(helpTop + 1, cap); break;
              case 'LINE_BACKWARD':
                helpTop = Math.max(helpTop - 1, 0); break;
              case 'WINDOW_FORWARD':
              case 'SET_WINDOW_FORWARD':
                helpTop = Math.min(helpTop + count, cap); break;
              case 'WINDOW_BACKWARD':
              case 'SET_WINDOW_BACKWARD':
                helpTop = Math.max(helpTop - count, 0); break;
              case 'SET_HALF_WINDOW_FORWARD':
                helpTop = Math.min(
                  helpTop + Math.floor(config.window / 2), cap);
                break;
              case 'SET_HALF_WINDOW_BACKWARD':
                helpTop = Math.max(
                  helpTop - Math.floor(config.window / 2), 0);
                break;
              case 'FIRST_LINE': helpTop = 0; break;
              case 'LAST_LINE': helpTop = cap; break;
              default: break;
            }
          }

          draw();
          continue;
        }

        // og's lsystem reinits after the done pause; a non-trivial
        // key ungets as the next command (get_return)
        if (shellPausing) {
          shellPausing = false;
          process.stdout.write(ALTERNATE_CONSOLE_ON + KEYPAD_ON);
          draw();

          if (key !== '\x0D' && key !== '\x0A' && key !== ' ' &&
              key !== '\x03') {
            onKey(Buffer.from(key));
          }

          continue;
        }

        // the ! / # command line runs through the shared line editor
        if (shelling) {
          if (!cmd.prefix && (key === '\x0D' || key === '\x0A')) {
            const text = cmdText();
            const bang = shelling;
            shelling = '';
            cmdClose();
            runShellCmd(bang, text);
          } else if (!cmd.prefix && key === '\x03') {
            shelling = '';
            cmdClose();
            draw();
          } else {
            const result = cmdChar(key);
            if (result === 'quit') { shelling = ''; cmdClose(); }
            for (let u = cmdUngot(); u !== null; u = cmdUngot()) cmdChar(u);
            draw();
          }

          continue;
        }

        // the : prefix dispatches its second char, like og's
        // ":"-prefixed command table
        if (coloning) {
          coloning = false;

          switch (key === '\x03' || key.startsWith('\x1B')
            ? ''
            : getAction(':' + key)) {
            case 'CURRENT_INFO':
              showInfo();
              break;
            case 'NEXT_FILE':
              // a single-file list, like og's edit_next failing
              message = 'No next file  (press RETURN)';
              msgReturn = true;
              break;
            case 'PREV_FILE':
              message = 'No previous file  (press RETURN)';
              msgReturn = true;
              break;
            case 'REMOVE_FILE':
              // og's getoff_ifile on the only file: just a bell
              process.stdout.write('\x07');
              break;
            case 'INDEX_FILE':
              // :x to the first (only) file: og's edit_ifile
              // short-circuits on the current ifile
              break;
            case 'OPEN_FILE':
              // examining another file is outside this session
              message = 'Command not available  (press RETURN)';
              msgReturn = true;
              break;
            case '':
              break;
            default:
              process.stdout.write('\x07');
              break;
          }

          draw();
          continue;
        }

        // - and -- run the shared option machinery; its reports
        // show like og's error() with the RETURN gate
        if (option.pending) {
          optionKey([], key);

          if (search.message) {
            message = search.message + '  (press RETURN)';
            search.message = '';
            msgReturn = true;
          }

          draw();
          continue;
        }

        // search prompt input runs through the shared line editor
        if (searching) {
          if (!cmd.prefix && (key === '\x0D' || key === '\x0A')) {
            const text = cmdText();

            if (text) {
              try {
                // -i smart case / -I like og: caseless unless the
                // pattern has uppercase under smart mode
                const caseless = search.caseless === 2 ||
                  (search.caseless === 1 && !/[A-Z]/.test(text));
                pattern = new RegExp(text, caseless ? 'i' : '');
                searchHistory.push(text);
                lastDir = searching === '/' ? 1 : -1;
                remember();
                runSearch(lastDir, view.top.pos);
              } catch {
                message = `Invalid pattern: ${text}`;
              }
            }

            searching = '';
            cmdClose();
          } else if (!cmd.prefix && key === '\x03') {
            searching = '';
            cmdClose();
          } else {
            const result = cmdChar(key);
            if (result === 'quit') { searching = ''; cmdClose(); }
            for (let u = cmdUngot(); u !== null; u = cmdUngot()) cmdChar(u);
          }

          draw();
          continue;
        }

        if (key === '/' || key === '?') {
          searching = key;
          cmdOpen(key, { history: searchHistory });
          draw();
          continue;
        }

        if (key === ':') {
          coloning = true;
          draw();
          continue;
        }

        if (key === 'n' || key === 'N') {
          const dir = key === 'n' ? lastDir : (-lastDir as 1 | -1);
          runSearch(dir, view.top.pos);
          buffer = [];
          resolveBottom();
          draw();
          continue;
        }

        // mouse wheel scrolls by --wheel-lines, --rmouse reversing
        if (SCROLL_UP_REGEX.test(key) || SCROLL_DOWN_REGEX.test(key)) {
          const down = SCROLL_DOWN_REGEX.test(key) !== optMouseReverse();
          if (down) {
            if (!view.lineForward(optWheelLines(), config.window)) ringBell('eof');
          } else if (!view.lineBackward(optWheelLines())) {
            ringBell('eof');
          }
          buffer = [];
          resolveBottom();
          draw();
          continue;
        }

        const n = parseInt(buffer.join(''), 10) || 1;
        const action = getAction(key);

        if (key >= '0' && key <= '9' && key.length === 1) {
          buffer.push(key);
          continue;
        }

        switch (action) {
          case 'FORCE_EXIT':
          case 'EXIT':
            quit();
            return;
          case 'LINE_FORWARD':
          case 'NEWLINE_FORWARD':
            if (!view.lineForward(n, config.window)) ringBell('eof');
            break;
          case 'FORCE_LINE_FORWARD':
            // og's J forces past the eof, stopping only when the
            // last line reaches the top (forw with force=TRUE)
            if (!view.lineForward(n)) ringBell('eof');
            break;
          case 'LINE_BACKWARD':
          case 'FORCE_LINE_BACKWARD':
          case 'NEWLINE_BACKWARD':
            if (!view.lineBackward(n)) ringBell('eof');
            break;
          case 'WINDOW_FORWARD':
          case 'SET_WINDOW_FORWARD':
            if (!view.lineForward(
              n === 1 ? config.window - 1 : n, config.window)) {
              ringBell('eof');
            }
            break;
          case 'NO_EOF_WINDOW_FORWARD':
            // ESC-SPACE forces a full window past the eof, like og
            if (!view.lineForward(n === 1 ? config.window - 1 : n)) {
              ringBell('eof');
            }
            break;
          case 'WINDOW_BACKWARD':
          case 'FORCE_WINDOW_BACKWARD':
          case 'SET_WINDOW_BACKWARD':
            if (!view.lineBackward(n === 1 ? config.window - 1 : n)) {
              ringBell('eof');
            }
            break;
          case 'SET_HALF_WINDOW_FORWARD':
            if (!view.lineForward(
              Math.floor(config.window / 2), config.window)) {
              ringBell('eof');
            }
            break;
          case 'SET_HALF_WINDOW_BACKWARD':
            if (!view.lineBackward(Math.floor(config.window / 2))) {
              ringBell('eof');
            }
            break;
          case 'SET_HALF_SCREEN_RIGHT':
            config.col +=
              n === 1 ? Math.floor(config.screenWidth / 2) : n;
            break;
          case 'SET_HALF_SCREEN_LEFT':
            config.col = Math.max(config.col -
              (n === 1 ? Math.floor(config.screenWidth / 2) : n), 0);
            break;
          case 'FIRST_COL': config.col = 0; break;
          case 'LAST_COL': {
            // ESC-$ shifts to the widest visible line's end
            const { rows } = view.visible(config.window - 1);
            let widest = 0;
            for (const row of rows) {
              widest = Math.max(widest, displayText(row.text).length);
            }
            config.col = Math.max(widest - config.screenWidth, 0);
            break;
          }
          case 'FIRST_LINE': remember(); view.gotoStart(); break;
          case 'LAST_LINE': remember(); view.gotoEnd(config.window); break;
          case 'GO_POS':
            // P goes to the N-th byte, like og's A_GOPOS
            remember();
            view.gotoPos(Math.min(
              parseInt(buffer.join(''), 10) || 0,
              Math.max(bf.size - 1, 0)
            ));
            break;
          case 'HIGHLIGHT_TOGGLE':
            // ESC-u, like og's undo_search toggling hilites
            search.highlight = !search.highlight;
            break;
          case 'CLEAR_SEARCH':
            // ESC-U forgets the pattern entirely
            pattern = null;
            break;
          case 'SPAN_REPEAT_SEARCH':
            // a single-file list: ESC-n behaves like n
            runSearch(lastDir, view.top.pos);
            break;
          case 'SPAN_REVERSE_SEARCH':
            runSearch(-lastDir as 1 | -1, view.top.pos);
            break;
          case 'PERCENT_LINE':
            remember();
            view.gotoPercent(Math.min(parseInt(buffer.join(''), 10) || 0,
              100));
            break;
          case 'SET_MARK': marking = 'm'; break;
          case 'SET_MARK_BOTTOM': marking = 'M'; break;
          case 'CLEAR_MARK': marking = 'c'; break;
          case 'GO_MARK': marking = "'"; break;
          case 'HELP':
            // og pages FAKE_HELPFILE through the same nroff pipeline
            if (!helpLines.length) helpLines = transformContent(help);
            helpTop = 0;
            break;
          case 'VERSION':
            versionMessage();
            message = search.message + '  (press RETURN)';
            search.message = '';
            msgReturn = true;
            break;
          case 'SAVE_FILE':
            // og's s on seekable input: "Input is not a pipe"
            message = 'Input is not a pipe  (press RETURN)';
            msgReturn = true;
            break;
          case 'EDIT_FILE':
            runEditor();
            break;
          case 'SHELL_COMMAND':
            shelling = '!';
            cmdOpen('!');
            break;
          case 'PSHELL_COMMAND':
            shelling = '#';
            cmdOpen('#');
            break;
          case 'NEXT_TAG':
            message = 'No next tag  (press RETURN)';
            msgReturn = true;
            break;
          case 'PREV_TAG':
            message = 'No previous tag  (press RETURN)';
            msgReturn = true;
            break;
          case 'OPTION_TAG':
            startOption('-');
            optionKey([], 't');
            break;
          case 'OPEN_FILE':
            message = 'Command not available  (press RETURN)';
            msgReturn = true;
            break;
          case 'NEXT_FILE':
            message = 'No next file  (press RETURN)';
            msgReturn = true;
            break;
          case 'PREV_FILE':
            message = 'No previous file  (press RETURN)';
            msgReturn = true;
            break;
          case 'REMOVE_FILE':
            process.stdout.write('\x07');
            break;
          case 'INDEX_FILE':
          case 'NOACTION':
            break;
          case 'REPAINT':
          case 'DROP_INPUT_REPAINT':
            bf.refreshSize();
            break;
          case 'TAG_COMMAND':
            // - (and _) open the option prompt, like og's mca_opt
            startOption(key === '_' ? '_' : '-');
            break;
          case 'CURRENT_INFO':
            showInfo();
            break;
          case 'FOLLOW_BELL':
          case 'FOLLOW_HILITE':
          case 'FOLLOW': {
            // F: jump to the end and wait for data, like forw_loop
            bf.refreshSize();
            view.gotoEnd(config.window);
            following = true;
            followTimer = setInterval(() => {
              const before = bf.size;
              if (bf.refreshSize() > before) {
                view.gotoEnd(config.window);
                draw();
              }
            }, 100);
            break;
          }
          default:
            // og bells on unmapped keys; mouse reports stay silent
            if (!key.startsWith('\x1b[<')) process.stdout.write('\x07');
            break;
        }

        buffer = [];
        resolveBottom();
        draw();
      }

      // keys the interrupt poll queued during a blocking scan run
      // now, like og's command loop draining the ungot queue —
      // except while a message waits: og's get_return reads the raw
      // tty, so queued keys stay behind it until a fresh key
      // dismisses (the stats survive scan-time typing)
      if (!msgReturn) {
        const pending = takeUngot();
        if (pending && !done) onKey(pending);
      }
    };

    // SIGTERM/SIGHUP restore the terminal like og's terminate();
    // 'resize' fires on every platform, unlike SIGWINCH
    process.on('SIGTERM', quit);
    process.on('SIGHUP', quit);
    watchWinch(onResize);

    keyboard().on('data', onKey);
    draw();

    // the RETURN gate's ungot key runs as the first command
    if (gateKey) onKey(Buffer.from(gateKey));

    // keys polled during the --file-size open scan run now
    if (!msgReturn) {
      const pending = takeUngot();
      if (pending && !done) onKey(pending);
    }
  });

  process.stdout.write(KEYPAD_OFF + ALTERNATE_CONSOLE_OFF);

  // $LESS may have enabled mouse tracking or bracketed paste
  if (opt.mouseMode || opt.emouse) {
    process.stdout.write(MOUSE_OFF + MOUSE_SGR_OFF);
  }

  if (opt.noPaste) process.stdout.write(BRACKETED_PASTE_OFF);

  keyboard().setRawMode(false);
  keyboard().pause();
  hook.screenActive = false;

  hook.scanFileSize = prevScanFileSize;

  // a /dev/tty keyboard holds the event loop open until destroyed
  closeTtyKeyboard();
  bf.close();
}
