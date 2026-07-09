import fs from 'fs';

import { spawnSync } from 'child_process';

import { optTagsFile } from "../options";

import { shellQuote } from "./prompt";

/** One tag match, like tags.c's struct tag. */
export interface Tag {
  file: string;
  /** 1-based line number; 0 when the tag uses a search pattern. */
  linenum: number;
  pattern: string | null;
  /** True when the pattern ended with `$` (must match to EOL). */
  endline: boolean;
}

// the loaded tag list and 1-based current position (curtag/curseq)
let list: Tag[] = [];
let cur = 0;

/** The number of loaded tag matches, like ntags(). */
export const ntags = (): number => list.length;

/** The 1-based current tag sequence, like curr_tag(). */
export const currTag = (): number => cur;

/** The current tag's file name, for the jump. */
export const currTagFile = (): string | null =>
  list[cur - 1]?.file ?? null;

/** Forgets the tag list, like cleantags(). */
export function resetTags(): void {
  list = [];
  cur = 0;
}

// the jump is performed by the pager (it switches files); a -t from
// $LESS arrives before the pager registers, so it stays pending
let tagJumpHook: (() => void) | null = null;
let pendingJump = false;

/** Asks the pager to jump to the current tag. */
export function requestTagJump(): void {
  if (tagJumpHook) tagJumpHook();
  else pendingJump = true;
}

/** Registers the pager's tag jump, running one queued by $LESS -t. */
export function onTagJump(fn: () => void): void {
  tagJumpHook = fn;

  if (pendingJump) {
    pendingJump = false;
    fn();
  }
}

/**
 * Loads the matches for a tag, like tags.c's findtag: the ctags file
 * named by -T, or global(1) output for the GTAGS-family names.
 *
 * @param tag - The tag to look up.
 * @returns null on success, or the og error message.
 */
export function findTag(tag: string): string | null {
  const tagsFile = optTagsFile();

  switch (tagsFile) {
    case 'GTAGS': return findGtag(tag, '');
    case 'GRTAGS': return findGtag(tag, 'r');
    case 'GSYMS': return findGtag(tag, 's');
    case 'GPATH': return findGtag(tag, 'P');
  }

  // a readable file is ctags format; otherwise og falls back to
  // global(1), like gettagtype's open() probe
  return fs.existsSync(tagsFile)
    ? findCtag(tag, tagsFile)
    : findGtag(tag, '');
}

/**
 * Steps through the tag matches (t / T), like nexttag/prevtag: each
 * step past either end stays put and reports null, non-circular.
 *
 * @param delta - 1 for the next match, -1 for the previous.
 * @param n - How many matches to step.
 * @returns The landed tag, or null when the list ran out.
 */
export function stepTag(delta: 1 | -1, n: number): Tag | null {
  let landed: Tag | null = null;

  while (n-- > 0) {
    const target = cur + delta;

    if (target < 1 || target > list.length) {
      landed = null;
      continue;
    }

    cur = target;
    landed = list[cur - 1];
  }

  return landed;
}

/**
 * Finds the current tag's row in the opened file, like ctagsearch: a
 * line-number tag jumps directly, a pattern tag scans for a line
 * starting with the (possibly truncated) pattern.
 *
 * @param content - The tag file's lines.
 * @returns The 0-based row, or null when the tag is not found.
 */
export function tagRow(content: string[]): number | null {
  const tag = list[cur - 1];
  if (!tag) return null;

  if (tag.linenum > 0) {
    // a line past EOF fails like og's find_pos returning NULL
    if (tag.linenum > content.length) return null;
    return tag.linenum - 1;
  }

  const pattern = tag.pattern ?? '';

  for (let row = 0; row < content.length; row++) {
    // og strips ANSI before matching under -R (our native mode)
    // eslint-disable-next-line no-control-regex
    const line = content[row].replace(/\x1B\[[0-9;]*m/g, '');

    if (
      line.startsWith(pattern) &&
      (!tag.endline || line.length === pattern.length ||
        line[pattern.length] === '\r')
    ) {
      // og caches the found line number on the tag
      tag.linenum = row + 1;
      return row;
    }
  }

  return null;
}

/**
 * Scans a ctags file for a tag, like findctag: every matching entry
 * joins the list; the location is a line number or a `/^pattern$/`
 * (backslashes unescaped, `^` dropped, a trailing `$` recorded).
 */
function findCtag(tag: string, tagsFile: string): string | null {
  let data: string;

  try {
    data = fs.readFileSync(tagsFile, 'utf8');
  } catch {
    return 'No tags file';
  }

  resetTags();
  const found: Tag[] = [];

  for (const line of data.split('\n')) {
    // extended format headers
    if (line.startsWith('!')) continue;

    if (!line.startsWith(tag)) continue;

    const after = line[tag.length];
    if (after !== ' ' && after !== '\t') continue;

    let i = tag.length;
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (i >= line.length) continue;

    const fileStart = i;
    while (i < line.length && line[i] !== ' ' && line[i] !== '\t') i++;
    const file = line.slice(fileStart, i);

    while (line[i] === ' ' || line[i] === '\t') i++;
    if (i >= line.length) continue;

    if (line[i] >= '0' && line[i] <= '9') {
      const linenum = parseInt(line.slice(i), 10);
      if (!linenum) continue;

      found.push({ file, linenum, pattern: null, endline: false });
      continue;
    }

    // a pattern between delimiters, usually /^...$/
    const delim = line[i++];
    if (line[i] === '^') i++;

    let pattern = '';

    while (i < line.length && line[i] !== delim) {
      if (line[i] === '\\') i++;
      pattern += line[i++] ?? '';
    }

    let endline = false;

    if (pattern.endsWith('$')) {
      endline = true;
      pattern = pattern.slice(0, -1);
    }

    found.push({ file, linenum: 0, pattern, endline });
  }

  if (!found.length) return 'No such tag in tags file';

  list = found;
  cur = 1;
  return null;
}

/**
 * Runs global(1) for a tag, like findgtag: $LESSGLOBALTAGS names the
 * command, `-x` plus the type flag selects the reference kind, and
 * the output parses like ctags -x (name [type] linenum file ...).
 */
function findGtag(tag: string, flag: string): string | null {
  const cmd = process.env.LESSGLOBALTAGS;
  if (!cmd) return 'No tags file';

  const shell = process.env.SHELL || '/bin/sh';
  const result = spawnSync(
    shell,
    ['-c', `${cmd} -x${flag} ${shellQuote(tag)}`],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) return 'No tags file';

  resetTags();
  const found: Tag[] = [];

  for (const raw of (result.stdout ?? '').split('\n')) {
    if (!raw) continue;

    const entry = getEntry(raw);
    if (!entry) break;

    found.push({
      file: entry.file,
      linenum: entry.linenum,
      pattern: null,
      endline: false,
    });
  }

  if (!found.length) return 'No such tag in tags file';

  list = found;
  cur = 1;
  return null;
}

/**
 * Parses one ctags -x line, like tags.c's getentry: the tag name, an
 * optional non-numeric type word, the line number and the file name.
 */
function getEntry(
  buf: string
): { file: string, linenum: number } | null {
  const parts = buf.split(/[ \t]+/).filter(Boolean);
  if (parts.length < 3) return null;

  let i = 1;
  if (!/^\d/.test(parts[i] ?? '')) i++;

  const linenum = parseInt(parts[i] ?? '', 10);
  const file = parts[i + 1];

  if (!parts[0] || !linenum || !file) return null;

  return { file, linenum };
}
