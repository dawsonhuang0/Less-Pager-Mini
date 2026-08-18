import fs from 'fs';
import os from 'os';
import path from 'path';

import { lesskeyForms, lesskeyFile, LesskeyForm, loadLesskey }
  from './lesskey';

import { files, makeFileList, FileEntry, saveFilePosition,
  getPreviousPath, setPreviousPath, examineHistoryLength,
  trimExamineHistory, forgetSourceFile } from './files';

import { markSnapshot, restoreMarkSnapshot, MarkSnapshot } from './jumping';

import { switchToFile } from '../commands';

import { renderLesskeyBinary } from './lesskeyRender';
import { compileLesskey } from './lesskeyCompile';
import { DEFAULT_KEYMAP } from './lesskeyCodes';

import { lgetenv } from '../startup/environment';
import { search } from './searching';
import { secureAllow } from './secure';
import { homeDir } from '../tty/platform';

/**
 * Opens this session's lesskey files in a pager of their own.
 *
 * NOT an og feature. og documents lesskey in a man page and leaves you
 * to find your own files, which works when a distribution put them
 * there; an npm install did not, and by the time six sources have
 * merged (system and user, source and compiled, and two environment
 * variables) "which lesskey am I actually running" is a fair question
 * with no way to ask it.
 *
 * So it is a VIEWER, not an editor. The pager already pages a list of
 * files, moves between them with :n and :p, and edits the one on
 * screen with `v` - which is $VISUAL or $EDITOR, the same as it has
 * always been. Nothing here needs to spawn an editor or quote a
 * command line.
 */

/** One form, and the file that stands in for it on screen. */
interface ViewFile {
  form: LesskeyForm | null;
  /** What the pager opens. */
  path: string;
  /** What the prompt calls it, when the path is a temp file. */
  display?: string;
  /** Written here, so it can be cleaned up and compiled back. */
  temporary: boolean;
}

/** Where a temp copy of a non-file form goes. */
function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lesskey-'));
}

/**
 * A label for a temp file, so the prompt says where it came from.
 *
 * The name is what the pager shows, and it is the only place a reader
 * learns that this text is a RENDERING of ~/.less rather than a file
 * anyone can open.
 */
function scratchName(form: LesskeyForm): string {
  const base = form.kind === 'content'
    ? form.origin
    : path.basename(form.origin);

  return `${base}${form.kind === 'binary' ? '.lesskey' : '.lesskey'}`;
}

/**
 * Materializes every loaded form as something the pager can open.
 *
 * A source file is already one. A compiled file is rendered back to
 * source, since bytes cannot be read or edited. A content variable is
 * written out as the text it holds.
 */
export function lesskeyViewFiles(): { files: ViewFile[], dir: string | null } {
  const forms = lesskeyForms();
  const files: ViewFile[] = [];
  let dir: string | null = null;

  const scratch = (): string => (dir ??= scratchDir());

  for (const form of forms) {
    if (form.kind === 'source') {
      files.push({ form, path: form.origin, temporary: false });
      continue;
    }

    let text: string | null = null;

    if (form.kind === 'binary') {
      try {
        text = renderLesskeyBinary(fs.readFileSync(form.origin));
      } catch {
        text = null;
      }
    } else {
      text = lgetenv(form.origin) ?? '';
      // a content variable is one line with ";" separators, which is
      // unreadable; og's own parser treats those as line breaks
      text = text.split(';').join('\n') + '\n';
    }

    if (text === null) continue;

    const file = path.join(scratch(), scratchName(form));
    fs.writeFileSync(file, text);

    // named for where it came from - the variable, or the compiled
    // file - because the temp path it lives at is noise: sixty
    // characters of /var/folders before the name even starts, on a
    // prompt that also carries the NEXT file's path
    files.push({ form, path: file, display: form.origin, temporary: true });
  }

  // nothing loaded at all: open the defaults, at the path the loader
  // would read next time. It is not written until the pager returns,
  // so looking costs nothing
  if (files.length === 0) {
    const target = lesskeyFile() ??
      path.join(homeDir(), '.lesskey');

    files.push({ form: null, path: target, temporary: false });
  }

  return { files, dir };
}

/**
 * Reads back what `v` wrote and says what is wrong with it, touching
 * nothing.
 *
 * Checking and loading are separate on purpose. The check runs while
 * the editor's screen is still up, so its messages print where the
 * text they are about is - the way a broken lesskey reports before
 * the pager takes the terminal at startup. The load runs after, and
 * says nothing: everything worth saying has been said.
 *
 * The compiler is the checker for both kinds of form. It parses the
 * same grammar the reader does and words its errors identically
 * (tests/lksweep.py compares them against og's own lesskey), and it
 * has no side effects - so a source file can be checked without
 * being loaded, which the reader could not do.
 *
 * @returns One message per bad line, in og's wording.
 */
export function checkLesskeyEdits(
  view: ViewFile[],
  version: number
): string[] {
  const problems: string[] = [];

  for (const file of view) {
    let text: string;

    try {
      text = fs.readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }

    const name = file.form?.origin ?? file.path;

    for (const error of compileLesskey(text, version).errors) {
      problems.push(`${name}: ${error}`);
    }
  }

  return problems;
}

/**
 * Writes back whatever the session may have edited through `v`, and
 * reloads, so the new bindings are live.
 *
 * A source file was edited in place and needs nothing but the reload.
 * A rendered binary is compiled back over the file it came from - the
 * one job the compiler exists for. A content variable goes back into
 * the variable, its lines rejoined with the ";" separators og's own
 * parser splits on; that cannot outlive the process, which is all an
 * environment variable ever could.
 *
 * @param version - The running less version, for #version lines.
 * @returns Messages for anything that could not be written back.
 */
export function applyLesskeyEdits(
  view: ViewFile[],
  version: number
): string[] {
  const messages: string[] = [];

  const report = (text: string): void => { messages.push(text); };

  for (const file of view) {
    if (file.form === null || !file.temporary) continue;

    let text: string;

    try {
      text = fs.readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }

    if (file.form.kind === 'content') {
      // straight into the process environment, not the lesskey #env
      // table: the reload below clears that table, and this has to
      // survive it to be worth anything
      process.env[file.form.origin] = text
        .split('\n')
        .filter(line => line !== '')
        .join(';');

      continue;
    }

    // errors and all: og's lesskey PROGRAM refuses to write output
    // when a source has any ("N errors; no output produced",
    // lesskey.c:316), but og's pager READING a lesskey does the
    // opposite - parse_lesskey reports each bad line and keeps every
    // binding that parsed (lesskey_parse.c). This is the reader's
    // job, so it takes the reader's rule: one mistyped action does
    // not cost the user the rest of what they wrote. Only a table too
    // large to encode leaves nothing to write
    // errors and all: og's lesskey PROGRAM refuses to write output
    // when a source has any ("N errors; no output produced",
    // lesskey.c:316), but og's pager READING a lesskey keeps every
    // binding that parsed. This is the reader's job, so one mistyped
    // action does not cost the user the rest of what they wrote - and
    // checkLesskeyEdits has already reported it
    const { data } = compileLesskey(text, version);

    if (data === null) {
      report(`${file.form.origin}: too large to write`);
      continue;
    }

    try {
      fs.writeFileSync(file.form.origin, data);
    } catch {
      report(`Cannot write ${file.form.origin}`);
    }
  }

  // quiet: checkLesskeyEdits has already said everything there is to
  // say about this text, where it could be read
  loadLesskey(true);

  return messages;
}

/** Seeds a missing default file with og's built-in bindings. */
export function seedDefaultKeymap(file: string): boolean {
  if (fs.existsSync(file)) return false;

  try {
    fs.writeFileSync(file, DEFAULT_KEYMAP.join('\n') + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Removes the scratch directory a view created. */
export function cleanLesskeyView(dir: string | null): void {
  if (dir === null) return;

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // a temp directory that will not go is the operating system's
    // problem, not something to interrupt a session over
  }
}

/**
 * What the session was looking at before the lesskey files replaced
 * it, so `q` can put it back.
 */
interface Stash {
  list: FileEntry[];
  index: number;
  files: ViewFile[];
  dir: string | null;
  /** So the ' mark cannot name a temp file that is about to go. */
  marks: MarkSnapshot;
  /** The `#` file, which a switch can overwrite. */
  previous: string | null;
  /** How long the examine history was, so temp paths can be trimmed. */
  history: number;
}

let stash: Stash | null = null;

/** True when the session's file list IS the lesskey forms already. */
let isViewSession = false;

/** The forms that session was built from, for their display names. */
let viewSessionFiles: ViewFile[] = [];

/**
 * Marks this session as being the view itself.
 *
 * `--view-lesskey` with no file has nothing to open over, so the
 * forms simply are the file list. The option scan still sees the
 * flag - from argv, or from $LESS where no filter can reach it - and
 * would open the view a SECOND time over itself, which took two q's
 * to leave one screen.
 */
export function markLesskeyViewSession(view: ViewFile[]): void {
  isViewSession = true;
  viewSessionFiles = view;
}

/**
 * Names the files of a session that IS the view.
 *
 * openLesskeyView does this as it builds the list; a session built by
 * the ordinary startup path has no such moment, so it happens once
 * the list exists.
 */
export function nameLesskeyViewSession(): void {
  for (const file of viewSessionFiles) {
    if (file.display === undefined) continue;

    const entry = files.list.find(listed => listed.path === file.path);

    if (entry) entry.display = file.display;
  }
}

/** True when opening a view again would only stack one on itself. */
export const isLesskeyViewSession = (): boolean => isViewSession;

/** Clears the mark, for a test or a second session in one process. */
export function resetLesskeyViewSession(): void {
  isViewSession = false;
  viewSessionFiles = [];
}

/** True while the lesskey files are the session's file list. */
export const inLesskeyView = (): boolean => stash !== null;

/**
 * Re-reads what `v` just edited, and makes it live.
 *
 * og does neither: its A_VISUAL is `lsystem(editproto)` and nothing
 * else (command.c:2137), so the screen keeps the text it had until R
 * flushes the buffers (clear_buffers, command.c:1846). That is right
 * for a file you are reading and wrong for this screen, where the
 * whole reason to open an editor is to change what the pager does -
 * and the edit taking effect only on the way out would mean quitting
 * to find out whether it worked.
 *
 * @returns A message when a write-back failed, else null.
 */
export function refreshLesskeyView(version: number): string[] {
  if (stash === null) return [];

  // only the file that was just edited. The others are as they were,
  // and a complaint about one of them here would be about something
  // the user did not touch - and would arrive attached to an editor
  // session that had nothing to do with it
  const current = files.list[files.index]?.path;
  const edited = stash.files.filter(file => file.path === current);

  // checked BEFORE anything is written or loaded, so the messages can
  // be shown while the editor's screen is still the one on the
  // terminal - and the load that follows has nothing left to report
  const problems = checkLesskeyEdits(edited, version);

  // the reload runs whatever was edited, since the tables are shared
  applyLesskeyEdits(edited, version);

  return problems;
}

/**
 * Swaps the lesskey files in as the session's file list.
 *
 * The same move the help screen makes, one level up: help stashes the
 * CONTENT and puts it back, this stashes the FILE LIST. Which has to
 * be the file list rather than a rendered blob, because the whole
 * point is that :n and :p walk between the forms and `v` opens the
 * one on screen in an editor - both of which are things the pager
 * only does for real files.
 *
 * A nested pager() would have been the obvious way and is the wrong
 * one: two sessions sharing one screen means two painters, and the
 * outer one's prompt timers keep firing into the row the inner one is
 * drawing on - measured as a doubled ":" on the prompt line, and a
 * `q` that tore down the shared keyboard and took both sessions with
 * it.
 *
 * @returns False when there is nothing to show, or a form could not
 *   be opened - the session is untouched either way.
 */
export function openLesskeyView(): boolean {
  if (stash !== null || !secureAllow('lesskey')) return false;

  const view = lesskeyViewFiles();

  // the defaults case writes the seed before opening it, so `v` has a
  // real file to edit and the loader finds it next time
  if (view.files.length === 1 && view.files[0].form === null) {
    seedDefaultKeymap(view.files[0].path);
  }

  // the file being left keeps its position, like edit_ifile storing
  // one before the switch - restoring it is the whole trick
  saveFilePosition();

  const held: Stash = {
    list: files.list,
    index: files.index,
    files: view.files,
    dir: view.dir,
    marks: markSnapshot(),
    previous: getPreviousPath(),
    history: examineHistoryLength(),
  };

  files.list = makeFileList(view.files.map(file => file.path));

  for (const [at, file] of view.files.entries()) {
    if (file.display !== undefined) files.list[at].display = file.display;
  }
  files.index = -1;

  if (!switchToFile(0)) {
    files.list = held.list;
    files.index = held.index;
    restoreLesskeyViewState(held);
    cleanLesskeyView(view.dir);
    return false;
  }

  stash = held;
  return true;
}

/**
 * Undoes what the swap wrote that would OUTLIVE it.
 *
 * A mark holds its file, not a place in the list, so nothing in here
 * can re-point one any more - what it can do is leave the ' mark
 * naming a file that gets DELETED on the way out, since a rendered
 * binary and a content variable are both temp files. edit_ifile
 * records that mark on every switch, so it happens whether or not
 * anyone set one, and `'` afterwards would simply do nothing.
 *
 * The `#` file and the examine history hold the same temp paths for
 * the same reason.
 */
function restoreLesskeyViewState(held: Stash): void {
  for (const file of held.files) forgetSourceFile(file.path);

  // the view is a screen, not a file the user opened: quitting it
  // ends it, so opening it again starts at the top like re-entering
  // help does. Without this the engine's per-path position brought
  // the last visit's scroll back

  restoreMarkSnapshot(held.marks);
  setPreviousPath(held.previous);
  trimExamineHistory(held.history);
}

/**
 * Puts the session back, like exitHelp: the stashed list returns and
 * the file that was open re-opens at its saved position.
 *
 * Anything edited through `v` is written back first - a rendered
 * binary compiled over the file it came from - and the tables are
 * reloaded, so a key changed in there works on the way out.
 *
 * @param version - The running less version, for #version lines.
 * @returns False when no lesskey view is open, so `q` can mean quit.
 */
export function exitLesskeyView(version: number): boolean {
  if (stash === null) return false;

  const held = stash;
  stash = null;

  const messages = applyLesskeyEdits(held.files, version);

  cleanLesskeyView(held.dir);

  files.list = held.list;
  files.index = -1;

  // -1 first, so this is a real switch rather than edit_ifile's
  // "already open" early return
  switchToFile(held.index);

  restoreLesskeyViewState(held);

  if (messages.length) search.message = messages[0];

  return true;
}
