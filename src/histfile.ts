import { secureAllow } from "./features/secure";

import fs from 'fs';
import path from 'path';

import { homeDir, HISTFILE_NAME } from './platform';

import { search, resetHistoryRecall } from './features/searching';

import { shellHistory, setShellHistory } from './features/misc';

import { optPermaMarks } from './options';

import {
  FileMark,
  setFileMarks,
  getFileMarks,
  allMarks,
  realPath
} from './features/jumping';

import { files, loadFile, byteOffset } from './features/files';

const FIRST_LINE = '.less-history-file:';
const SEARCH_SECTION = '.search';
const SHELL_SECTION = '.shell';
const MARK_SECTION = '.mark';

// og's histfile_modified flags: cmd_accept raises each mlist's own
// modified flag (cleared when that section is written), mark.c
// raises marks_modified at setmark/clrmark/lastmark (never cleared)
let searchListModified = false;
let shellListModified = false;
let marksModified = false;

// entries added this session, og's per-entry modified flags: the save
// merges them onto the CURRENT disk file's sections (copy_hist +
// write_mlist), so concurrent sessions' entries survive
const newSearch: string[] = [];
const newShell: string[] = [];

/** Raises the search mlist's flag, like cmd_accept. */
export function touchSearchList(): void {
  searchListModified = true;
}

/** Raises the shell mlist's flag, like cmd_accept. */
export function touchShellList(): void {
  shellListModified = true;
}

/** Records a new search entry, og's cmdbuf.c:798 entry-modified bit
 *  (set BEFORE the autosave attempt, unlike the list flag). */
export function recordSearchEntry(entry: string): void {
  newSearch.push(entry);
}

/** Records a new shell entry, same entry-modified semantics. */
export function recordShellEntry(entry: string): void {
  newShell.push(entry);
}

/** Raises og's marks_modified. */
export function touchMarks(): void {
  marksModified = true;
}

/**
 * Loads the search history from the less history file (~/.lesshst).
 *
 * - Uses the same file, format and lookup order as less, so history is
 *   shared with the real pager across sessions and files.
 */
export function loadHistory(): void {
  if (!secureAllow('history')) return;

  setFileMarks([]);

  const file = histfilePath(true);
  if (!file) return;

  let text: string;

  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }

  const lines = text.split('\n');
  if (!lines[0].startsWith(FIRST_LINE)) return;

  const patterns: string[] = [];
  const shell: string[] = [];
  const restored: FileMark[] = [];
  let section = '';

  for (const line of lines.slice(1)) {
    if (line.startsWith('.')) {
      section = line;
    } else if (
      section === SEARCH_SECTION && line.startsWith('"') && line.length > 1
    ) {
      patterns.push(line.slice(1));
    } else if (
      section === SHELL_SECTION && line.startsWith('"') && line.length > 1
    ) {
      shell.push(line.slice(1));
    } else if (section === MARK_SECTION) {
      // "m X <sline> <pos> <filename>", like less's save_marks
      const match = /^m (\S) (-?\d+) (\d+) (.+)$/.exec(line);

      if (match) {
        restored.push({
          char: match[1],
          sline: parseInt(match[2], 10),
          pos: parseInt(match[3], 10),
          path: match[4],
        });
      }
    }
  }

  // og's init_cmdhist reads with no skip: the whole file loads into
  // memory, and $LESSHISTSIZE applies only through the save-time
  // skip of the disk copy's head
  search.history = patterns;
  resetHistoryRecall();
  setShellHistory(shell);
  setFileMarks(restored);

  // restored entries are unmodified, like addhist_init passing 0
  searchListModified = false;
  shellListModified = false;
  marksModified = false;
  newSearch.length = 0;
  newShell.length = 0;
}

/**
 * Saves the search history back to the less history file.
 *
 * - Rewrites only the `.search` section, preserving `.shell` and `.mark`
 *   sections written by less itself.
 * - Skipped when the history is unchanged or disabled via LESSHISTFILE=-.
 */
export function saveHistory(): void {
  // og's save_cmdhist gate: nothing was modified since the load (an
  // action-based test, not a content diff - pressing m without
  // --save-marks still dirties the file)
  if (!secureAllow('history')) return histDebug('secure disallows history');
  if (!searchListModified && !shellListModified && !marksModified) {
    return histDebug('nothing modified');
  }

  const marks = markLines();

  const file = histfilePath(false);
  if (!file) return histDebug('no history file path');

  // og's save_cmdhist re-reads the CURRENT disk file and replays it
  // through copy_hist: known sections' entries copy through (head
  // lines skipped by the memory list's overflow over $LESSHISTSIZE),
  // this session's new entries append at a known-section transition
  // or under a fresh header at EOF (og's duplicate-header quirk when
  // .search ends the file), and mark/unknown lines drop - marks
  // rewrite from memory below. Concurrent sessions' entries survive.
  const skips: Record<'search' | 'shell', number> = {
    search: Math.max(search.history.length - historyLimit(), 0),
    shell: Math.max(shellHistory.length - historyLimit(), 0),
  };
  // og's write_mlist runs only for a list whose own modified flag is
  // up: a write triggered by marks alone (or by the other list)
  // copies this section through UNCHANGED, its new entries pending
  // until its own next accept - hence og's header-only first writes
  const fresh: Record<'search' | 'shell', string[]> = {
    search: searchListModified ? [...newSearch] : [],
    shell: shellListModified ? [...newShell] : [],
  };

  let body = '';
  let current: 'search' | 'shell' | null = null;

  const flush = (which: 'search' | 'shell'): string => {
    const out = fresh[which].map(e => '"' + e + '\n').join('');
    fresh[which].length = 0;
    return out;
  };

  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    if (lines[0].startsWith(FIRST_LINE)) {
      for (const line of lines.slice(1)) {
        const known = line === SEARCH_SECTION
          ? 'search' as const
          : line === SHELL_SECTION ? 'shell' as const : null;

        if (known) {
          // a repeated header of the same section keeps copying
          // without a new header, normalizing og's split sections
          if (known !== current) {
            if (current) body += flush(current);
            body += line + '\n';
            current = known;
          }
        } else if (line.startsWith('.')) {
          current = null;
        } else if (current && line.startsWith('"') && line.length > 1) {
          if (skips[current] > 0) skips[current]--;
          else body += line + '\n';
        }
      }
    }
  } catch {
    // no existing history file
  }

  // og's end-of-file block: entries still pending get their own
  // header - even right after a copied section of the same name
  for (const which of ['search', 'shell'] as const) {
    if (fresh[which].length) {
      body += (which === 'search' ? SEARCH_SECTION : SHELL_SECTION) +
        '\n' + flush(which);
    }
  }

  const section = body;
  const shellSection = '';

  // og's save_marks prints the .mark header unconditionally, so a
  // flagless session leaves a visible empty section
  const markSection = MARK_SECTION + '\n' +
    (marks.length ? marks.join('\n') + '\n' : '');

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      FIRST_LINE + '\n' + section + shellSection + markSection,
      { mode: 0o600 }
    );

    // og's write_mlist clears a written list's flag and entry bits;
    // an unwritten list keeps both; marks_modified stays
    if (searchListModified) {
      searchListModified = false;
      newSearch.length = 0;
    }
    if (shellListModified) {
      shellListModified = false;
      newShell.length = 0;
    }
    histDebug(`wrote ${file}`);
  } catch (error) {
    // history is best-effort; never break the pager over it
    histDebug(`write failed for ${file}: ${error}`);
  }
}

/** LMN_DBG=1 tracing for the silent-by-design history writes. */
function histDebug(text: string): void {
  if (process.env.LMN_DBG) {
    fs.writeSync(2, `[lmn hist] ${text}\n`);
  }
}

// the active-marks provider for --save-marks: the bigfile session
// substitutes its own byte-position marks while it runs
let sessionMarks: (() => FileMark[]) | null = null;

/** Registers (or clears) a session's own active-marks source. */
export function onSessionMarks(fn: (() => FileMark[]) | null): void {
  sessionMarks = fn;
}

/**
 * Builds the `.mark` section lines: the restored history-file marks
 * merged with the active marks when --save-marks is on, like less's
 * save_marks.
 */
function markLines(): string[] {
  const merged = new Map<string, string>();

  for (const mark of getFileMarks()) {
    merged.set(mark.char, `m ${mark.char} ${mark.sline} ${mark.pos} ` +
      mark.path);
  }

  if (optPermaMarks() && sessionMarks) {
    for (const m of sessionMarks()) {
      merged.set(m.char, `m ${m.char} ${m.sline} ${m.pos} ${m.path}`);
    }
  } else if (optPermaMarks()) {
    const lineCache = new Map<number, string[] | null>();

    for (const { char, mark } of allMarks()) {
      const entry = files.list[mark.file];
      if (!entry || entry.path === '-') continue;

      if (!lineCache.has(mark.file)) {
        lineCache.set(mark.file, loadFile(mark.file));
      }

      const lines = lineCache.get(mark.file);
      if (!lines) continue;

      const pos = byteOffset(lines, mark.row);

      // og's save_marks writes get_real_filename: the canonical
      // path, so a relative open restores from anywhere
      merged.set(char, `m ${char} ${mark.sline} ${pos} ` +
        realPath(entry.path));
    }
  }

  // og's save_marks walks the table in index order: a-z, A-Z,
  // mousemark '#', lastmark ' last
  return [...merged.entries()]
    .sort((a, b) => markOrder(a[0]) - markOrder(b[0]))
    .map(([, line]) => line);
}

function markOrder(char: string): number {
  if (char >= 'a' && char <= 'z') return char.charCodeAt(0) - 97;
  if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 65 + 26;
  if (char === '#') return 52;
  return 53;
}

// helpers

function histfilePath(mustExist: boolean): string | null {
  const env = process.env.LESSHISTFILE;

  if (env) {
    if (env === '-' || env === '/dev/null') return null;
    return env;
  }

  const home = homeDir();
  const candidates: string[] = [];

  if (process.env.XDG_STATE_HOME) {
    candidates.push(path.join(process.env.XDG_STATE_HOME, 'lesshst'));
  }

  if (home) {
    candidates.push(path.join(home, '.local', 'state', 'lesshst'));
  }

  if (process.env.XDG_DATA_HOME) {
    candidates.push(path.join(process.env.XDG_DATA_HOME, 'lesshst'));
  }

  if (home) {
    // ".lesshst" on unix, "_lesshst" on Windows (defines.wn)
    candidates.push(path.join(home, HISTFILE_NAME));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (mustExist || !candidates.length) return null;

  // og's histfile_find(FALSE): the first candidate whose directory
  // exists wins (dirfile opens the dir); $HOME's dotfile needs no check
  for (const candidate of candidates.slice(0, -1)) {
    if (fs.existsSync(path.dirname(candidate))) return candidate;
  }

  return candidates[candidates.length - 1];
}

function historyLimit(): number {
  const size = parseInt(process.env.LESSHISTSIZE ?? '', 10);
  return size > 0 ? size : 100;
}
