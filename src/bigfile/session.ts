import { keyboard } from '../keyboard';

import { BlockFile } from './ch';
import { BigView, displayText } from './screen';

import { getLayout, emitRow } from '../lines/lineLayout';

import { config } from '../config';

import { getAction, splitKeys } from '../normalKeys';

import { forwLine, backLine } from './lineio';

import { search, searchInterrupted } from '../features/searching';

import { optPrType, optIntrChar } from '../options/shared';

import { scanOptions } from '../options';

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
  CLEAR_LINE,
  CLEAR_BELOW,
  CURSOR_HOME,
  SYNC_ON,
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
  const view = new BigView(bf);

  // $LESS (and lmn's command line riding it) applies here too
  scanOptions(process.env.LESS ?? '', []);

  keyboard().setRawMode(true);
  keyboard().resume();
  process.stdout.write(ALTERNATE_CONSOLE_ON + KEYPAD_ON);

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
  let marking: 'm' | "'" | '' = '';

  // F follow state, like og's forw_loop
  let following = false;
  let followQueue: string[] = [];
  let followTimer: ReturnType<typeof setInterval> | null = null;

  /** Records the pre-jump position into the quote mark, like lastmark. */
  const remember = (): void => {
    quoteMark = { ...view.top };
  };

  /**
   * Streams the file line by line for the pattern, like og's search
   * walking ch buffers; ^X interrupts via the tty poll.
   */
  const runSearch = (dir: 1 | -1, fromTop: number): boolean => {
    if (!pattern) return false;

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
    const count = config.window - 1;
    const { rows } = view.visible(count);

    const display: string[] = [];

    for (const row of rows) {
      const text = displayText(row.text);
      let out: string;

      if (config.chopLongLines || config.col) {
        // chop: the layout's first row is exactly one screen width
        out = emitRow(getLayout(text), 0);
      } else {
        out = emitRow(getLayout(text), row.subRow);
      }

      // highlight search matches in view, like og's hilites
      if (pattern && search.highlight) {
        const global = new RegExp(pattern.source,
          pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
        out = out.replace(global,
          m => (m ? INVERSE_ON + m + INVERSE_OFF : m));
      }

      display.push(out);
    }

    while (display.length < count) display.push('~');

    const percent = bf.size
      ? Math.floor((view.top.pos * 100) / bf.size)
      : 100;
    const name = first ? `${path} ` : '';

    // og prompt styles: short shows ':', -m percent, -M the works
    const base = optPrType() === 2
      ? `${path} byte ${view.top.pos}/${bf.size} ${percent}%`
      : optPrType() === 1
        ? `${percent}%`
        : ':';

    const prompt = searching
      ? searching + cmdDisplay()
      : marking
        ? (marking === 'm' ? 'set mark: ' : 'goto mark: ')
        : following
          ? `${INVERSE_ON}Waiting for data${INVERSE_OFF}`
          : message
            ? `${INVERSE_ON}${message}${INVERSE_OFF}`
            : view.atEof
              ? `${INVERSE_ON}${name}(END)${INVERSE_OFF}`
              : first
                ? `${INVERSE_ON}${name}${INVERSE_OFF}`
                : optPrType() === 0
                  ? base
                  : `${INVERSE_ON}${base}${INVERSE_OFF}`;

    const body = display.map(r => CLEAR_LINE + r).join('\n');
    process.stdout.write(
      SYNC_ON + CURSOR_HOME + body + '\n' + CLEAR_LINE + prompt +
      CLEAR_BELOW + SYNC_OFF
    );
  };

  /** Ends F follow mode and replays queued keys, like og. */
  const endFollow = (): string[] => {
    following = false;
    if (followTimer) clearInterval(followTimer);
    followTimer = null;

    const queued = followQueue;
    followQueue = [];
    return queued;
  };

  await new Promise<void>(resolve => {
    const onKey = (data: Buffer): void => {
      for (const key of splitKeys(data.toString())) {
        first = false;
        message = '';

        // F wait: ^C / --intr return to paging, other keys queue as
        // commands for afterwards, like og's forw_loop
        if (following) {
          if (key === '\x03' || key === optIntrChar()) {
            const queued = endFollow();
            draw();
            for (const q of queued) onKey(Buffer.from(q));
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
            if (kind === 'm') {
              if (/^[a-zA-Z#]$/.test(key[0])) {
                marks.set(key[0], { ...view.top });
              } else {
                message = `Invalid mark letter ${key[0]}`;
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

        if (key === 'n' || key === 'N') {
          const dir = key === 'n' ? lastDir : (-lastDir as 1 | -1);
          runSearch(dir, view.top.pos);
          buffer = [];
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
            if (followTimer) clearInterval(followTimer);
            keyboard().off('data', onKey);
            resolve();
            return;
          case 'LINE_FORWARD': view.lineForward(n); break;
          case 'LINE_BACKWARD': view.lineBackward(n); break;
          case 'WINDOW_FORWARD':
            view.lineForward(n === 1 ? config.window - 1 : n);
            break;
          case 'WINDOW_BACKWARD':
            view.lineBackward(n === 1 ? config.window - 1 : n);
            break;
          case 'SET_HALF_WINDOW_FORWARD':
            view.lineForward(Math.floor(config.window / 2));
            break;
          case 'SET_HALF_WINDOW_BACKWARD':
            view.lineBackward(Math.floor(config.window / 2));
            break;
          case 'FIRST_LINE': remember(); view.gotoStart(); break;
          case 'LAST_LINE': remember(); view.gotoEnd(config.window); break;
          case 'PERCENT_LINE':
            remember();
            view.gotoPercent(Math.min(parseInt(buffer.join(''), 10) || 0,
              100));
            break;
          case 'SET_MARK': marking = 'm'; break;
          case 'GO_MARK': marking = "'"; break;
          case 'REPAINT':
          case 'DROP_INPUT_REPAINT':
            bf.refreshSize();
            break;
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
          default: break;
        }

        buffer = [];
        draw();
      }
    };

    keyboard().on('data', onKey);
    draw();
  });

  process.stdout.write(KEYPAD_OFF + ALTERNATE_CONSOLE_OFF);
  keyboard().pause();
  bf.close();
}
