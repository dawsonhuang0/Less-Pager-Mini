import { config } from '../state/config';

import { lgetenv } from '../startup/environment';

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
export function osc8Links(lines: string[], param?: string): Osc8Link[] {
  const links: Osc8Link[] = [];
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
        // less requires the closing sequence to start strictly AFTER
        // the opening ends - op2.osc8_start > op1.osc8_end
        // (search.c:1417) - so a link with no TEXT between the two is
        // not a link at all and the scan moves on. Files generated
        // from man pages are full of them: an anchor like
        // "ESC]8;:id=1;# ESC\ ESC]8;; ESC\" marks a position and
        // shows nothing
        // searching for a PARAMETER lifts the rule: less's two guards
        // both end in "|| param != NULL" (search.c:1412 and :1417),
        // because an id= anchor is exactly an empty link
        if (match.index > opened.after || param !== undefined) {
          if (param === undefined || opened.params.split(':').includes(param)) {
            links.push({
              row,
              start: opened.after,
              end: match.index,
              params: opened.params,
              uri: opened.uri,
            });
          }
        }

        opened = null;
      }
    }
  }

  return links;
}

/** Selects the Nth OSC 8 link in either direction, wrapping once. */
/** True while the selected link's row is displayed, less's onscreen(). */
export function osc8Visible(lines: string[]): boolean {
  if (!selected) return false;
  return selected.row >= config.row && selected.row <= bottomRow(lines);
}

/** less's osc8_search (search.c:2005): continue from an on-screen
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
    // less errors and returns: the old selection survives
    search.message = 'OSC 8 link not found';
    return false;
  }

  selected = links[at];
  setOsc8Display({ row: selected.row, start: selected.start });

  // less saves the URI at every selection; the next prompt cycle
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
  // less's osc8_jump: an unconditional jump_loc to the -j line
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

/**
 * True when the selected link points INSIDE the file: less treats a URI
 * with no scheme that starts with "#" as a link to an "id=" anchor
 * and searches for it forward with wrap, running no handler at all
 * (search.c:1942).
 */
export function osc8Internal(): string | null {
  if (!selected) return null;

  const uri = selected.uri;
  const colon = uri.indexOf(':');

  return colon < 0 && uri.startsWith('#') ? `id=${uri.slice(1)}` : null;
}

/** Selects the anchor an internal link names, wrapping like less. */
export function osc8SearchParam(lines: string[], param: string): boolean {
  const links = osc8Links(lines, param);

  if (!links.length) {
    search.message = 'OSC 8 link not found';
    return false;
  }

  const from = selected ? selected.row : config.row;
  const next = links.find(link => link.row > from) ?? links[0];

  // SRCH_WRAP: reaching the end and continuing at the top reports,
  // like any wrapped search (search.c:1949 passes SRCH_FORW|SRCH_WRAP)
  if (next.row <= from) {
    search.message = 'Search hit bottom; continuing at top';
  }

  selected = next;
  setOsc8Display({ row: next.row, start: next.start });
  return true;
}

export function osc8OpenCommand(): { command: string; done: string | null } |
  null {
  if (!selected) {
    search.message = 'No OSC8 link selected';
    return null;
  }

  return osc8CommandForUri(selected.uri);
}
