import path from 'path';

import { config, mode } from "../config";

import { visualWidth } from "../helpers";

import { files, bottomRow, byteOffset, percentage } from "./files";

import { optLinenums, optQuotes, optHeader, vlinenum } from "../options";

import { ntags, currTag } from "./tags";

// screen positions selected by the where char, like less's position.h
type Where = 't' | 'm' | 'b' | 'B' | 'j';

// shell metacharacters, like less's DEF_METACHARS
const METACHARS = "; *?\t\n'\"()<>[]|&^`#\\$%=~{},";

// the prompt prototypes, ported from prompt.c
const S_PROTO =
  '?n?f%f .?m(%T %i of %m) ..?e(END) ?x- Next\\: %x..%t';
const M_PROTO =
  '?n?f%f .?m(%T %i of %m) ..?e(END) ?x- Next\\: %x.:' +
  '?pB%pB\\%:byte %bB?s/%s...%t';
const LONG_PROTO =
  '?f%f .?n?m(%T %i of %m) ..?ltlines %lt-%lb?L/%L. :byte %bB?s/%s. .' +
  '?e(END) ?x- Next\\: %x.:?pB%pB\\%..?c (column %c).%t';
const E_PROTO =
  '?f%f .?m(%T %i of %m) .?ltlines %lt-%lb?L/%L. .byte %bB?s/%s. ' +
  '?e(END) :?pB%pB\\%..?c (column %c).%t';
const H_PROTO =
  'HELP -- ?eEND -- Press g to see it again:Press RETURN for more.' +
  ', or q when done';
const W_PROTO = 'Waiting for data';

/** Prompt prototypes for the short, medium and long styles (-m/-M). */
const prproto = [S_PROTO, M_PROTO, LONG_PROTO];

/** The `=` command prototype (-P=). */
let eqproto = E_PROTO;

/** The help screen prompt prototype (-Ph). */
let hproto = H_PROTO;

/** The F command waiting prompt prototype (-Pw). */
let wproto = W_PROTO;

/** Returns the prompt prototype for a style (0 short, 1 medium, 2 long). */
export const prProto = (type: number): string =>
  prproto[Math.min(Math.max(type, 0), 2)];

/** The `=` command prototype. */
export const eqProto = (): string => eqproto;

/** The help prompt prototype. */
export const hProto = (): string => hproto;

/** The F command waiting prompt prototype. */
export const wProto = (): string => wproto;

/**
 * Stores a -P prompt definition, like less's opt__P: the first char
 * selects which prototype is changed.
 *
 * @param text - The raw -P answer (e.g. `s`, `m`, `M`, `=`, `h` prefix).
 */
export function setProto(text: string): void {
  switch (text[0]) {
    case 's': prproto[0] = text.slice(1); return;
    case 'm': prproto[1] = text.slice(1); return;
    case 'M': prproto[2] = text.slice(1); return;
    case '=': eqproto = text.slice(1); return;
    case 'h': hproto = text.slice(1); return;
    case 'w': wproto = text.slice(1); return;
    default: prproto[0] = text;
  }
}

/**
 * Restores the built-in prototypes for a fresh pager run.
 */
export function resetProtos(): void {
  prproto[0] = S_PROTO;
  prproto[1] = M_PROTO;
  prproto[2] = LONG_PROTO;
  eqproto = E_PROTO;
  hproto = H_PROTO;
  wproto = W_PROTO;
}

/**
 * Expands a prompt prototype string, like less's pr_expand.
 *
 * - `%x` escapes expand pager state (file name, line, percent, ...),
 *   `?x...:....` are conditionals ended by `.`, and `\` takes the next
 *   character literally.
 *
 * @param content - Full content lines.
 * @param proto - The prototype string.
 * @returns The expanded message.
 */
export function prExpand(content: string[], proto: string): string {
  let out = '';

  for (let i = 0; i < proto.length; i++) {
    const char = proto[i];

    if (char === '\\') {
      if (i + 1 < proto.length) out += proto[++i];
    } else if (char === '?') {
      if (i + 1 < proto.length) {
        const condChar = proto[++i];

        // the where char is consumed but never changes what is known
        i = whereChar(proto, condChar, i)[1];

        if (!cond(content, out, condChar)) i = skipCond(proto, i);
      }
    } else if (char === ':') {
      i = skipCond(proto, i);
    } else if (char === '.') {
      // ENDIF: nothing to do
    } else if (char === '%') {
      if (i + 1 < proto.length) {
        const protoChar = proto[++i];
        const [where, next] = whereChar(proto, protoChar, i);
        i = next;

        out = protochar(content, out, protoChar, where);
      }
    } else {
      out += char;
    }
  }

  return out;
}

/**
 * Reads the optional screen-position char following `b d l p P`, like
 * less's wherechar. Returns the position and the last consumed index.
 */
function whereChar(
  proto: string,
  char: string,
  i: number
): [Where, number] {
  if ('bdlpP'.includes(char) && 'tmbBj'.includes(proto[i + 1] ?? '')) {
    return [proto[i + 1] as Where, i + 1];
  }

  return ['t', i];
}

/**
 * Skips a false conditional through its `:` else or `.` endif, tracking
 * nesting and backslash escapes, like less's skipcond.
 */
function skipCond(proto: string, i: number): number {
  let level = 1;

  for (;;) {
    const char = proto[++i];

    if (char === undefined) return i - 1;
    if (char === '?') level++;
    else if (char === ':' && level === 1) return i;
    else if (char === '.' && --level === 0) return i;
    else if (char === '\\' && i + 1 < proto.length) ++i;
  }
}

/**
 * Resolves a screen-position char to a content row, like less mapping
 * TOP/MIDDLE/BOTTOM/BOTTOM_PLUS_ONE to displayed lines.
 */
function whereRow(content: string[], where: Where): number {
  switch (where) {
    case 'm':
      return Math.min(
        config.row + Math.floor((config.window - 1) / 2),
        content.length - 1
      );

    case 'b': return bottomRow(content);
    case 'B': return Math.min(bottomRow(content) + 1, content.length);

    // the jump target defaults to the top line (-j unset)
    default: return config.row;
  }
}

/**
 * Evaluates a conditional char, like less's cond().
 */
function cond(content: string[], out: string, char: string): boolean {
  const entry = files.list[files.index];

  switch (char) {
    case 'a': return out.length > 0;
    case 'c': return config.col !== 0;
    case 'e': return mode.EOF;

    case 'f': case 'g':
      return entry !== undefined && entry.path !== '-';

    case 'm':
      return ntags() ? ntags() > 1 : files.list.length > 1;

    case 'n': return files.newFile;

    // OSC 8 links are not supported
    case 'O': return false;

    case 'P': return optLinenums() > 0 && content.length > 0;

    case 'Q':
      return config.col + config.screenWidth < longestLine(content);

    case 'x': return files.list[files.index + 1] !== undefined;

    // line numbers are only known while -n keeps them on
    case 'l': case 'd': case 'L': case 'D':
      return optLinenums() > 0;

    // byte offset, size and byte percent are always known
    case 'b': case 'p': case 's': case 'B':
      return true;
  }

  return false;
}

/**
 * Expands a percent escape char, like less's protochar(): appends to
 * the message and returns it.
 */
function protochar(
  content: string[],
  out: string,
  char: string,
  where: Where
): string {
  const entry = files.list[files.index];
  const next = files.list[files.index + 1];
  const size = Math.max(entry ? entry.size : 0, 1);

  // pages shrink by the pinned --header lines, like prompt.c's PAGE_NUM
  const pageSize = Math.max(config.window - 1 - optHeader().lines, 1);

  switch (char) {
    case 'b':
      return out +
        Math.min(byteOffset(content, whereRow(content, where)), size);

    case 'c': return out + (config.col + 1);
    case 'C': return out + (config.col + config.screenWidth);

    case 'd':
      return out + (optLinenums()
        ? String(Math.floor(whereRow(content, where) / pageSize) + 1)
        : '?');

    case 'D':
      return out + (!optLinenums()
        ? '?'
        : content.length
          ? String(Math.floor((content.length - 1) / pageSize) + 1)
          : '0');

    case 'E':
      return out + (process.env.VISUAL || process.env.EDITOR || 'vi');

    case 'f': return out + (entry ? entry.path : '?');
    case 'F': return out + (entry ? path.basename(entry.path) : '?');
    case 'g': return out + (entry ? shellQuote(entry.path) : '?');

    case 'G':
      return out + (entry ? shellQuote(path.basename(entry.path)) : '?');

    case 'i':
      return out + (ntags() ? currTag() : files.index + 1);

    case 'l':
      return out +
        (optLinenums() ? String(vlinenum(whereRow(content, where) + 1)) : '?');

    case 'L':
      return out + (optLinenums() ? String(vlinenum(content.length)) : '?');
    case 'm':
      return out + (ntags() ? ntags() : files.list.length);

    case 'p':
      return out + percentage(
        Math.min(byteOffset(content, whereRow(content, where)), size),
        size
      );

    case 'P':
      return out + (optLinenums()
        ? String(percentage(whereRow(content, where) + 1, content.length))
        : '?');

    case 'Q':
      return out + percentage(
        config.col + config.screenWidth,
        Math.max(longestLine(content), 1)
      );

    case 's': case 'B': return out + size;
    case 't': return out.replace(/ +$/, '');
    case 'T': return out + (ntags() ? 'tag' : 'file');
    case 'W': return out + longestLine(content);
    case 'x': return out + (next ? next.path : '?');
    case 'y': return out + (next ? shellQuote(next.path) : '?');
    case '%': return out + '%';
  }

  return out;
}

/**
 * Width of the longest displayed line, like less's
 * longest_line_width: full content lines on the current screen.
 */
function longestLine(content: string[]): number {
  const last = Math.min(config.row + config.window - 2, content.length - 1);
  let longest = 0;

  for (let row = config.row; row <= last; row++) {
    longest = Math.max(longest, visualWidth(content[row]));
  }

  return longest;
}

/**
 * Escapes shell metacharacters, like less's shell_quote on unix: each
 * metachar takes a backslash, a newline is surrounded by the -" quote
 * characters.
 */
export function shellQuote(name: string): string {
  const { open, close } = optQuotes();

  // $LESSMETACHARS and $LESSMETAESCAPE override the defaults, like
  // filename.c's metachars()/esc_metachars(); an empty escape means
  // the whole name gets the quote characters instead
  const meta = process.env.LESSMETACHARS ?? METACHARS;
  const esc = process.env.LESSMETAESCAPE ?? '\\';

  if (esc === '' && [...name].some(char => meta.includes(char))) {
    return open + name + close;
  }

  let quoted = '';

  for (const char of name) {
    if (char === '\n') quoted += open + '\n' + close;
    else if (meta.includes(char)) quoted += esc + char;
    else quoted += char;
  }

  return quoted;
}
