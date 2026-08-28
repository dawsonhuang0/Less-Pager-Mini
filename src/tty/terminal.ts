import { tgetent, tgetflag, tgetnum, tgetstr } from './terminfo';

import fs from 'fs';

import { actualEnv, lgetenv, sessionEnv, terminalEnv }
  from '../startup/environment';

/** Decodes the string syntax used by an inline TERMCAP entry. */
function decodeTermcap(text: string): string {
  let out = '';

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '^' && i + 1 < text.length) {
      out += String.fromCharCode(text.charCodeAt(++i) & 0x1F);
      continue;
    }

    if (text[i] !== '\\' || i + 1 >= text.length) {
      out += text[i];
      continue;
    }

    const next = text[++i];
    const named: Record<string, string> = {
      E: '\x1b', e: '\x1b', n: '\n', r: '\r', t: '\t',
      b: '\b', f: '\f', ':': ':', '\\': '\\',
    };

    if (named[next] !== undefined) {
      out += named[next];
      continue;
    }

    if (/[0-7]/.test(next)) {
      let octal = next;
      for (let n = 0; n < 2 && /[0-7]/.test(text[i + 1] ?? ''); n++) {
        octal += text[++i];
      }
      out += String.fromCharCode(parseInt(octal, 8));
      continue;
    }

    out += next;
  }

  return out;
}

/** Resolves a literal TERMCAP entry or the TERM entry in a named file. */
function termcapEntry(): string | undefined {
  // $TERMCAP is the DATABASE, and less reads it through tgetent inside
  // the termcap library - never through lgetenv, which is why
  // $LESSNOCONFIG hides every LESS_TERMCAP_* override from less while
  // leaving the database itself in place. A library caller's own
  // overlay still counts: that is the application's configuration,
  // not the environment it was launched in.
  const source = sessionEnv('TERMCAP') ?? actualEnv('TERMCAP');
  if (!source) return undefined;
  if (!source.startsWith('/')) return source;

  let text: string;
  try {
    text = fs.readFileSync(source, 'utf8');
  } catch {
    return undefined;
  }

  const term = terminalEnv();
  if (!term) return undefined;

  const entries = text
    .replace(/\\\r?\n[ \t]*/g, '')
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'));

  const find = (name: string): string | undefined => entries.find(entry =>
    entry.slice(0, entry.indexOf(':')).split('|').includes(name));

  const resolve = (entry: string | undefined, seen: Set<string>): string |
    undefined => {
    if (!entry) return undefined;
    const inherited = /(?:^|:)tc=([^:]+)(?=:|$)/.exec(entry)?.[1];
    if (!inherited || seen.has(inherited)) return entry;
    seen.add(inherited);
    const parent = resolve(find(inherited), seen);
    return parent ? entry + ':' + parent.slice(parent.indexOf(':') + 1) : entry;
  };

  return resolve(find(term), new Set([term]));
}

/** Finds a capability in the TERMCAP entry. */
function inlineTermcap(name: string): string | undefined {
  const source = termcapEntry();
  if (!source) return undefined;

  let field = '';
  const fields: string[] = [];
  let escaped = false;

  for (const char of source) {
    if (char === ':' && !escaped) {
      fields.push(field);
      field = '';
      continue;
    }
    field += char;
    escaped = !escaped && char === '\\';
    if (char !== '\\') escaped = false;
  }
  fields.push(field);

  for (const item of fields.slice(1)) {
    if (item === name) return '1';
    // A canceled capability is distinct from a missing one: the empty
    // string suppresses the built-in fallback just as tgetstr returning
    // an explicitly disabled capability does in less.
    if (item.startsWith(name + '@')) return '';
    if (item.startsWith(name + '=')) return decodeTermcap(item.slice(3));
    if (item.startsWith(name + '#')) return item.slice(3);
  }

  return undefined;
}

/**
 * less's ltget_env: debug marker, terminfo-name override, then the
 * two-character termcap override. TERMCAP supplies our database fallback.
 */
export function terminalCapability(
  terminfo: string | null,
  termcap: string | null
): string | undefined {
  const name = termcap ?? terminfo ?? '';
  if (lgetenv('LESS_TERMCAP_DEBUG')) return `<${name}>`;

  if (terminfo !== null) {
    const value = lgetenv(`LESS_TERMINFO_${terminfo}`);
    if (value) return value;
  }

  if (termcap !== null) {
    const value = lgetenv(`LESS_TERMCAP_${termcap}`);
    if (value) return value;

    // a $TERMCAP entry answers next, and a CANCELED capability there
    // (the empty string) is an answer: it suppresses what follows
    const inline = inlineTermcap(termcap);
    if (inline !== undefined) return inline;
  }

  // and then the terminal's own strings. less links curses and calls
  // tgetstr, so this is the tier that normally answers; without it
  // every caller fell through to its own hardcoded default
  if (terminfo !== null) {
    loadTerminfo();
    const value = tgetstr(terminfo);
    if (value !== null) return stripPadding(value);
  }

  return undefined;
}

/**
 * Drops a terminfo padding spec, the way less's tputs does at speed 0.
 *
 * A database string may carry "$<100/>" -- xterm's flash does -- which
 * is an instruction to tputs, not output. less calls
 * setupterm(term, -1, NULL), leaving ospeed 0, so tputs emits no
 * padding at all and the capability goes out bare. Passing the spec
 * through would print "$<100/>" on the screen.
 */
function stripPadding(value: string): string {
  return value.replace(/\$<[0-9.]*[*/]*>/g, '');
}

// less's DEFAULT_TERM (screen.c:133): an unset $TERM still names an
// entry, and "unknown" is a real one - it is how a terminal with no
// capabilities at all gets described rather than left undescribed.
// (less's other spelling, "ansi", is the OS2 build's; node has none.)
const DEFAULT_TERM = 'unknown';

// tgetent is less's one-time load at init; doing it on first use keeps
// the $TERM lookup after the environment tiers have been set up
let terminfoLoaded = false;
let terminfoEntry = false;

/** Loads the compiled entry for $TERM, once, like less's tgetent. */
function loadTerminfo(): void {
  if (terminfoLoaded) return;
  terminfoLoaded = true;

  const named = terminalEnv();

  // the entry is still LOADED through DEFAULT_TERM, so every lookup
  // gets less's own answers...
  const found = tgetent(named || DEFAULT_TERM) === 1;

  // ...but reaching one only by falling back is not an answer about
  // THIS terminal. "unknown" is the entry less uses to say it does not
  // know which terminal this is - it is why it prints "WARNING:
  // terminal is not fully functional" - and calling that described
  // suppressed every guess below: CLEAR_LINE went empty so the screen
  // could not be repainted, and no special key was bound at all.
  // MEASURED with TERM unset: ESC O B dead, j alive, nothing redrawn.
  terminfoEntry = found && named !== '' && named !== undefined;
}

/**
 * Whether the terminal database described this terminal.
 *
 * less always has an answer here: it links curses, so a capability the
 * entry omits is genuinely ABSENT and less uses the empty string. We
 * read the compiled entries ourselves, so a miss can also mean we
 * found no database to read - and there the hardcoded ANSI guesses
 * are the better answer. This tells the two apart.
 */
export function terminfoAnswered(): boolean {
  loadTerminfo();
  return terminfoEntry;
}

/** Forgets the loaded entry, so a fresh session re-reads $TERM. */
export function resetTerminfo(): void {
  terminfoLoaded = false;
  terminfoEntry = false;
}

export function terminalNumber(
  terminfo: string | null,
  termcap: string | null
): number | undefined {
  const value = terminalCapability(terminfo, termcap);

  if (value !== undefined) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  }

  // likewise, a number lives in its own section
  if (terminfo !== null) {
    loadTerminfo();
    const num = tgetnum(terminfo);
    if (num >= 0) return num;
  }

  return undefined;
}

export function terminalFlag(
  terminfo: string | null,
  termcap: string | null
): boolean | undefined {
  const value = terminalCapability(terminfo, termcap);
  if (value !== undefined) return value !== '' && value !== '0';

  // a boolean lives in the database's flag section, which tgetstr
  // cannot see
  if (terminfo !== null) {
    loadTerminfo();
    const flag = tgetflag(terminfo);
    if (flag >= 0) return flag !== 0;
  }

  return undefined;
}

/** Small tparm/tgoto subset covering less's row/column capabilities. */
export function formatTerminalCapability(
  capability: string,
  first: number,
  second: number
): string {
  let params = [first, second];
  let next = 0;

  return capability
    .replace(/\$<[^>]*>/g, '')
    .replace(/%i/g, () => {
      params = params.map(value => value + 1);
      return '';
    })
    .replace(/%r/g, () => { params = [params[1], params[0]]; return ''; })
    .replace(/%%|%p([12])%d|%d|%([23])|%\+(.?)|%\./g,
      (token, position: string | undefined, width: string | undefined,
        plus: string | undefined) => {
        if (token === '%%') return '%';
        const value = position
          ? params[parseInt(position, 10) - 1]
          : params[Math.min(next++, 1)];
        if (width) return String(value).padStart(parseInt(width, 10), '0');
        if (plus !== undefined) {
          return String.fromCharCode(value + (plus.charCodeAt(0) || 0));
        }
        if (token === '%.') return String.fromCharCode(value);
        return String(value);
      });
}
