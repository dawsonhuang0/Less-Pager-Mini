import { keyboard } from '../keyboard';

import { BlockFile } from './ch';
import { BigView } from './screen';

import { config } from '../config';

import { getAction, splitKeys } from '../normalKeys';

import { transformContent } from '../helpers';

import { forwLine, backLine } from './lineio';

import { searchInterrupted } from '../features/searching';

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

    const texts = transformContent(rows.map(r => r.text));
    const display: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const width = config.screenWidth - 1;
      const text = texts[i] ?? '';

      // chop mode with wrap sub-rows handled by the view; here each
      // row clips to the screen (parity shifts arrive with search)
      display.push(config.chopLongLines
        ? text.slice(config.col, config.col + width)
        : text.slice(rows[i].subRow * width, (rows[i].subRow + 1) * width));
    }

    while (display.length < count) display.push('~');

    const percent = bf.size
      ? Math.floor(((view.top.pos) * 100) / bf.size)
      : 100;
    const name = first ? `${path} ` : '';
    const prompt = searching
      ? searching + cmdDisplay()
      : message
        ? `${INVERSE_ON}${message}${INVERSE_OFF}`
        : view.atEof
          ? `${INVERSE_ON}${name}(END)${INVERSE_OFF}`
          : first
            ? `${INVERSE_ON}${name}${INVERSE_OFF}`
            : `:${percent}%`;

    const body = display.map(r => CLEAR_LINE + r).join('\n');
    process.stdout.write(
      SYNC_ON + CURSOR_HOME + body + '\n' + CLEAR_LINE + prompt +
      CLEAR_BELOW + SYNC_OFF
    );
  };

  await new Promise<void>(resolve => {
    const onKey = (data: Buffer): void => {
      for (const key of splitKeys(data.toString())) {
        first = false;
        message = '';

        // search prompt input runs through the shared line editor
        if (searching) {
          if (!cmd.prefix && (key === '\x0D' || key === '\x0A')) {
            const text = cmdText();

            if (text) {
              try {
                pattern = new RegExp(text);
                searchHistory.push(text);
                lastDir = searching === '/' ? 1 : -1;
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
          case 'FIRST_LINE': view.gotoStart(); break;
          case 'LAST_LINE': view.gotoEnd(config.window); break;
          case 'PERCENT_LINE':
            view.gotoPercent(Math.min(parseInt(buffer.join(''), 10) || 0,
              100));
            break;
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
