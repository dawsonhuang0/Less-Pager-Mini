import { secureAllow } from "./features/secure";

import fs from 'fs';
import os from 'os';
import path from 'path';

import { search, resetHistoryRecall } from './features/searching';

import { shellHistory, setShellHistory } from './features/misc';

import { optPermaMarks } from './options';

import {
  FileMark,
  setFileMarks,
  getFileMarks,
  allMarks
} from './features/jumping';

import { files, loadFile, byteOffset } from './features/files';

const FIRST_LINE = '.less-history-file:';
const SEARCH_SECTION = '.search';
const SHELL_SECTION = '.shell';
const MARK_SECTION = '.mark';

let loadedKey = '';

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

  search.history = patterns.slice(-historyLimit());
  resetHistoryRecall();
  setShellHistory(shell.slice(-historyLimit()));
  setFileMarks(restored);
  loadedKey = JSON.stringify([search.history, shellHistory, markLines()]);
}

/**
 * Saves the search history back to the less history file.
 *
 * - Rewrites only the `.search` section, preserving `.shell` and `.mark`
 *   sections written by less itself.
 * - Skipped when the history is unchanged or disabled via LESSHISTFILE=-.
 */
export function saveHistory(): void {
  if (!secureAllow('history')) return;

  const entries = search.history.slice(-historyLimit());
  const shell = shellHistory.slice(-historyLimit());
  const marks = markLines();
  if (JSON.stringify([entries, shell, marks]) === loadedKey) return;

  const file = histfilePath(false);
  if (!file) return;

  let others = '';

  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    if (lines[0].startsWith(FIRST_LINE)) {
      const kept: string[] = [];
      let keep = false;

      for (const line of lines.slice(1)) {
        if (line.startsWith('.')) {
          keep = line !== SEARCH_SECTION && line !== SHELL_SECTION &&
            line !== MARK_SECTION;
        }

        if (keep && line !== '') kept.push(line);
      }

      if (kept.length) others = kept.join('\n') + '\n';
    }
  } catch {
    // no existing history file
  }

  const section = entries.length
    ? SEARCH_SECTION + '\n' + entries.map(p => '"' + p).join('\n') + '\n'
    : '';

  const shellSection = shell.length
    ? SHELL_SECTION + '\n' + shell.map(c => '"' + c).join('\n') + '\n'
    : '';

  const markSection = marks.length
    ? MARK_SECTION + '\n' + marks.join('\n') + '\n'
    : '';

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      FIRST_LINE + '\n' + section + shellSection + markSection + others,
      { mode: 0o600 }
    );
    loadedKey = JSON.stringify([entries, shell, marks]);
  } catch {
    // history is best-effort; never break the pager over it
  }
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

  if (optPermaMarks()) {
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
      merged.set(char, `m ${char} ${mark.sline} ${pos} ${entry.path}`);
    }
  }

  return [...merged.values()].sort();
}

// helpers

function histfilePath(mustExist: boolean): string | null {
  const env = process.env.LESSHISTFILE;

  if (env) {
    if (env === '-' || env === '/dev/null') return null;
    return env;
  }

  const home = os.homedir();
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
    candidates.push(path.join(home, '.lesshst'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (mustExist || !candidates.length) return null;

  return candidates[candidates.length - 1];
}

function historyLimit(): number {
  const size = parseInt(process.env.LESSHISTSIZE ?? '', 10);
  return size > 0 ? size : 100;
}
