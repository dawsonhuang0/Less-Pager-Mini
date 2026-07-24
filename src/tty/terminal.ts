import fs from 'fs';

import { lgetenv, terminalEnv } from '../startup/environment';

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
  const source = lgetenv('TERMCAP');
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
    // an explicitly disabled capability does in og.
    if (item.startsWith(name + '@')) return '';
    if (item.startsWith(name + '=')) return decodeTermcap(item.slice(3));
    if (item.startsWith(name + '#')) return item.slice(3);
  }

  return undefined;
}

/**
 * OG's ltget_env: debug marker, terminfo-name override, then the
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
    return inlineTermcap(termcap);
  }

  return undefined;
}

export function terminalNumber(
  terminfo: string | null,
  termcap: string | null
): number | undefined {
  const value = terminalCapability(terminfo, termcap);
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

export function terminalFlag(
  terminfo: string | null,
  termcap: string | null
): boolean | undefined {
  const value = terminalCapability(terminfo, termcap);
  return value === undefined ? undefined : value !== '' && value !== '0';
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
