import { config } from '../config';

import { lgetenv } from '../environment';

import { shellQuote } from './prompt';

import { search } from './searching';

export interface Osc8Link {
  row: number;
  start: number;
  end: number;
  params: string;
  uri: string;
}

let selected: Osc8Link | null = null;

export const selectedOsc8 = (): Osc8Link | null => selected;
export const resetOsc8 = (): void => { selected = null; };

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
export function searchOsc8(
  lines: string[],
  direction: 1 | -1,
  count: number = 1
): boolean {
  const links = osc8Links(lines);
  if (!links.length) {
    search.message = 'No OSC8 links found';
    selected = null;
    return false;
  }

  let at = selected ? links.findIndex(link =>
    link.row === selected!.row && link.start === selected!.start) : -1;
  if (at < 0) {
    at = direction > 0
      ? links.findIndex(link => link.row >= config.row) - 1
      : links.findLastIndex(link => link.row <= config.row) + 1;
  }

  const steps = Math.max(count, 1);
  for (let n = 0; n < steps; n++) {
    at = (at + direction + links.length) % links.length;
  }
  selected = links[at];
  return true;
}

/** Positions the selected link's line at the top of the display. */
export function jumpOsc8(): boolean {
  if (!selected) {
    search.message = 'No OSC8 link selected';
    return false;
  }
  config.row = selected.row;
  config.subRow = 0;
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
