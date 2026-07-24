import { config } from '../config';

import { lgetenv } from '../environment';

import { shellQuote } from './prompt';

import { search } from './searching';

import { bottomRow } from './files';

import { jumpLoc } from './jumping';

import { jumpSindex } from '../options';

import { setOsc8Display } from '../lines/helpers';

export interface Osc8Link {
  row: number;
  start: number;
  end: number;
  params: string;
  uri: string;
}

let selected: Osc8Link | null = null;

export const selectedOsc8 = (): Osc8Link | null => selected;
export const setSelectedOsc8 = (link: Osc8Link | null): void => {
  selected = link;
  setOsc8Display(link ? { row: link.row, start: link.start } : null);
};
export const resetOsc8 = (): void => { setSelectedOsc8(null); };

/** Extracts complete OSC 8 open/text/close pairs from materialized lines. */
export function osc8Links(lines: string[]): Osc8Link[] {
  const links: Osc8Link[] = [];
  // eslint-disable-next-line no-control-regex
  const sequence = /\x1b\]8;([^;\x07]*);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    sequence.lastIndex = 0;
    let opened: { at: number; after: number; params: string; uri: string } |
      null = null;
    let match: RegExpExecArray | null;

    while ((match = sequence.exec(line)) !== null) {
      if (match[2]) {
        opened = {
          at: match.index,
          after: sequence.lastIndex,
          params: match[1],
          uri: match[2],
        };
      } else if (opened) {
        links.push({
          row,
          start: opened.after,
          end: match.index,
          params: opened.params,
          uri: opened.uri,
        });
        opened = null;
      }
    }
  }

  return links;
}

/** Selects the Nth OSC 8 link in either direction, wrapping once. */
/** True while the selected link's row is displayed, og's onscreen(). */
export function osc8Visible(lines: string[]): boolean {
  if (!selected) return false;
  return selected.row >= config.row && selected.row <= bottomRow(lines);
}

/** og's osc8_search (search.c:2005): continue from an on-screen
 *  selection (same line first — link order covers it); an off-screen
 *  or absent selection starts at the -j line like search_pos; no
 *  wrap — a miss errors and KEEPS the old selection. */
export function searchOsc8(
  lines: string[],
  direction: 1 | -1,
  count: number = 1
): boolean {
  const links = osc8Links(lines);
  let remaining = Math.max(count, 1);

  let at: number;

  const sel = selected;
  const selAt = sel ? links.findIndex(link =>
    link.row === sel.row && link.start === sel.start) : -1;

  if (selAt >= 0 && osc8Visible(lines)) {
    at = selAt;
  } else {
    // start at the -j line, like a normal search
    const startRow = config.row + jumpSindex();

    if (direction > 0) {
      const first = links.findIndex(link => link.row >= startRow);
      at = (first < 0 ? links.length : first) - 1;
    } else {
      at = links.findLastIndex(link => link.row <= startRow) + 1;
    }
  }

  at += direction * remaining;
  remaining = 0;

  if (at < 0 || at >= links.length) {
    // og errors and returns: the old selection survives
    search.message = 'OSC 8 link not found';
    return false;
  }

  selected = links[at];
  setOsc8Display({ row: selected.row, start: selected.start });

  // og saves the URI at every selection; the next prompt cycle
  // reports it (command.c:905 "Link: %s")
  search.message = `Link: ${selected.uri}`;
  return true;
}

/** Positions the selected link's line at the top of the display. */
export function jumpOsc8(lines: string[]): boolean {
  if (!selected) {
    search.message = 'No OSC8 link selected';
    return false;
  }
  // og's osc8_jump: an unconditional jump_loc to the -j line
  jumpLoc(lines, selected.row, 0, jumpSindex());
  return true;
}

/** Builds the exact handler command selected by LESS_OSC8_OPEN_*. */
export function osc8CommandForUri(
  uri: string
): { command: string; done: string | null } | null {
  const colon = uri.indexOf(':');
  const scheme = colon < 0 ? 'NONE' : uri.slice(0, colon).toLowerCase();
  const envName = `LESS_OSC8_OPEN_${scheme}`;
  let handler = lgetenv(envName);
  if (!handler || handler === '-') handler = lgetenv('LESS_OSC8_OPEN_ANY');

  if (!handler) {
    search.message = `No handler for "${scheme}" link type`;
    return null;
  }

  let done: string | null = 'link done';
  if (handler.startsWith('\x10')) {
    handler = handler.slice(1);
    done = null;
  }

  return { command: `${handler} ${shellQuote(uri)}`, done };
}

export function osc8OpenCommand(): { command: string; done: string | null } |
  null {
  if (!selected) {
    search.message = 'No OSC8 link selected';
    return null;
  }

  return osc8CommandForUri(selected.uri);
}
