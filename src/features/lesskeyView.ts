import fs from 'fs';
import os from 'os';
import path from 'path';

import { lesskeyForms, lesskeyFile, LesskeyForm, loadLesskey }
  from './lesskey';

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
    files.push({ form, path: file, temporary: true });
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
 * Writes back whatever the session may have edited through `v`.
 *
 * A source file was edited in place and needs nothing. A rendered
 * binary is compiled back over the file it came from - the one job
 * the compiler exists for. A content variable cannot be written
 * anywhere that outlives the process, so it is left alone.
 *
 * @returns Messages for anything that could not be written back.
 */
export function writeBackLesskey(files: ViewFile[], version: number): string[] {
  const messages: string[] = [];

  for (const file of files) {
    if (file.form?.kind !== 'binary' || !file.temporary) continue;

    let text: string;

    try {
      text = fs.readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }

    const { data, errors } = compileLesskey(text, version);

    if (errors.length || data === null) {
      // og's own compiler writes nothing when a source has errors
      // ("N errors; no output produced", lesskey.c:316), and neither
      // does this - the file it would overwrite still works
      messages.push(`${path.basename(file.form.origin)}: ${errors[0]}` +
        (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''));
      continue;
    }

    try {
      fs.writeFileSync(file.form.origin, data);
    } catch {
      messages.push(`Cannot write ${file.form.origin}`);
    }
  }

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
 * Pages the session's lesskey files, then reloads whatever changed.
 *
 * The nested call is what makes `q` mean "done looking" rather than
 * "quit": it unwinds this pager and leaves the one underneath exactly
 * as it was.
 *
 * @param version - The running less version, for #version lines.
 * @param env - The library caller's environment, passed straight on.
 */
export async function viewLesskey(
  version: number,
  env: Record<string, string> | null = null
): Promise<void> {
  if (!secureAllow('lesskey')) return;

  const { files, dir } = lesskeyViewFiles();

  // the defaults case writes the seed before opening it, so `v` has a
  // real file to edit and the loader finds it next time
  if (files.length === 1 && files[0].form === null) {
    seedDefaultKeymap(files[0].path);
  }

  try {
    const { default: pager } = await import('../index');

    await pager(files.map(file => file.path), ['--examine-file'], env);
  } finally {
    const messages = writeBackLesskey(files, version);

    cleanLesskeyView(dir);

    // an edited file only takes effect once it is read again
    loadLesskey(true);

    if (messages.length) search.message = messages[0];
  }
}
