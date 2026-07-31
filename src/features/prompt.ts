import path from 'path';

import { DEF_METACHARS, DEF_METAESCAPE, EDIT_PGM } from "../tty/platform";

import { config, mode } from "../state/config";

import { visualWidth } from "../lines/helpers";

import { files, bottomRow, byteOffset, percentage, sizeIsKnown,
  byteBase } from "./files";

import { hook, opt, optLinenums, optQuotes, optHeader, vlinenum,
  vlinenumAbsolute }
  from "../options";

import { ntags, currTag } from "./tags";

import { selectedOsc8 } from "./osc8";

import { lgetenv } from '../startup/environment';

import { session } from '../state/session';

// screen positions selected by the where char, like less's position.h
type Where = 't' | 'm' | 'b' | 'B' | 'j';

// shell metacharacters, like less's DEF_METACHARS (per platform)
const METACHARS = DEF_METACHARS;

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
const MORE_PROTO =
  '--More--(?eEND ?x- Next\\: %x.:?pB%pB\\%:byte %bB?s/%s...%t)';

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
 * Restores the built-in prototypes for a fresh pager run, like og's
 * init_prompt: more mode replaces the medium prompt with --More--.
 */
export function resetProtos(): void {
  prproto[0] = S_PROTO;
  prproto[1] = opt.lessIsMore ? MORE_PROTO : M_PROTO;
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
 * True when the file has no lines at all, which is og's currline()
 * returning 0: the position table is empty, so there is no line number
 * to report. Our content array still carries one synthetic empty line
 * for such a file.
 */
function noLines(content: string[]): boolean {
  return content.length <= 1 && !content[0] &&
    (files.list[files.index]?.size ?? 0) <= 0;
}

/**
 * Evaluates a conditional char, like less's cond().
 */
function cond(content: string[], out: string, char: string): boolean {
  const entry = files.list[files.index];

  switch (char) {
    case 'a': return out.length > 0;
    case 'c': return config.col !== 0;

    // og's eof_displayed: with a pipe's length unknown, the bottom
    // line at the end is not yet (END) — the help file always knows.
    // It asks where the bottom line ends in the FILE, so a tail
    // hidden by a & filter keeps it short of the end
    case 'e':
      return mode.EOF && !session.filterHidesTail &&
        (mode.HELP || sizeIsKnown());

    case 'f': case 'g':
      return entry !== undefined && entry.path !== '-';

    case 'm':
      return ntags() ? ntags() > 1 : files.list.length > 1;

    case 'n':
      // og: with an active tag list ?n is ALWAYS true (prompt.c:242)
      // - a -t session shows the file name on every prompt, since
      // tag jumps switch files
      return ntags() > 0 || files.newFile;

    // og's ?O: "OSC 8 link selected?" - `osc8_linepos != NULL_POSITION`
    // (prompt.c:246, documented at less.nro.VER:2868). Note the
    // neighbouring %O EXPANSION does not exist at HEAD: e0d51f0 added
    // it and 3e11cb4 removed it again when the handler stopped being
    // prompt-expanded, so only the condition survives.
    case 'O': return selectedOsc8() !== null;

    case 'P': return optLinenums() > 0 && content.length > 0;

    case 'Q':
      return config.col + config.screenWidth < longestLine(content);

    case 'x': return files.list[files.index + 1] !== undefined;

    // line numbers are only known while -n keeps them on
    // og's cond is `linenums && currline(where) != 0` (prompt.c:229):
    // a line NUMBER of zero means it is not known - which is the state
    // an empty file is permanently in, since it has no lines at all.
    // og then takes the ELSE branch of the -M prompt and reports the
    // byte instead
    case 'l': case 'd':
      return optLinenums() > 0 && !noLines(content);

    // the LAST line and page need the input's LENGTH, not merely a
    // finished stream: og's cond is linenums && ch_length() !=
    // NULL_POSITION (prompt.c:233), and a pipe's length stays
    // unknown until a read returns its EOI
    case 'L': case 'D':
      return optLinenums() > 0 && sizeIsKnown();

    // the byte offset is always known; the size and byte percent
    // wait for a pipe's length, like ch_length() != NULL_POSITION
    case 'b': return true;

    case 'p': case 's': case 'B':
      return sizeIsKnown();
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
  // og keeps the real length and guards the DIVISION instead: `%p`
  // asks `if (pos != NULL_POSITION && len > 0)` and prints "?"
  // otherwise (prompt.c:396). Clamping the length to 1 made an empty
  // file report a size of one byte
  const size = entry ? entry.size : 0;

  // pages shrink by the pinned --header lines, like prompt.c's PAGE_NUM
  const pageSize = Math.max(config.window - 1 - optHeader().lines, 1);
  const row = whereRow(content, where);

  // og's position(where) indexes the SCREEN, not the content: TOP is
  // row 0, BOTTOM is sc_height-2, BOTTOM_PLUS_ONE sc_height-1, MIDDLE
  // the middle row (position.c). On a wrapped line those are rows
  // INSIDE a line, which is why %bB and %pB report a mid-line byte
  const sindex = (): number => {
    switch (where) {
      case 'm': return Math.floor((config.window - 1) / 2);
      case 'b': return config.window - 2;
      case 'B': return config.window - 1;
      default: return 0;
    }
  };

  const absoluteByte = (): number => {
    const byRow = hook.sourceRowByte?.(sindex());
    if (byRow !== undefined && byRow !== null) return byRow;

    const sourced = hook.sourceBytePosition?.(row);
    return sourced === undefined
      ? byteOffset(content, row) + byteBase()
      : sourced ?? 0;
  };

  const absoluteLine = (): number => {
    const sourced = hook.sourceLineNumber?.(row);
    return sourced === undefined ? row + 1 : sourced ?? 0;
  };

  switch (char) {
    case 'b':
      // recycled pipe data still counts in the offset (og positions);
      // an unknown length never clamps — entry.size is stale while a
      // pipe still streams (og's curr_byte reports the raw position)
      return out + (sizeIsKnown()
        ? Math.min(absoluteByte(), size)
        : absoluteByte());

    case 'c': return out + (config.col + 1);
    case 'C': return out + (config.col + config.screenWidth);

    case 'd':
      return out + (optLinenums()
        ? String(Math.floor(Math.max(absoluteLine() - 1, 0) / pageSize) + 1)
        : '?');

    // og's %D expands '?' while ch_length is unknown even without
    // the ?D guard (prompt.c:317), 0 for an empty file
    case 'D':
      if (!optLinenums() || !sizeIsKnown()) return out + '?';
      if (hook.sourceLineCount) {
        const total = hook.sourceLineCount();
        if (total === undefined) {
          return out + (content.length
            ? String(Math.floor((content.length - 1) / pageSize) + 1)
            : '0');
        }
        return out + (total === null
          ? '?'
          : total
            ? String(Math.floor((total - 1) / pageSize) + 1)
            : '0');
      }
      return out + (content.length
        ? String(Math.floor((content.length - 1) / pageSize) + 1)
        : '0');

    case 'E':
      // EDIT_PGM is "vi" on unix and "edit" on Windows (defines.wn)
      return out + (lgetenv('VISUAL') || lgetenv('EDITOR') || EDIT_PGM);

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

    // og's %L is '?' while ch_length is unknown, and also for an
    // EMPTY file (len == ch_zero, prompt.c:379) — unlike %D's 0
    case 'L':
      if (!optLinenums() || !sizeIsKnown()) return out + '?';
      if (hook.sourceLineCount) {
        const total = hook.sourceLineCount();
        if (total === undefined) {
          return out + (content.length
            ? String(vlinenum(content.length))
            : '?');
        }
        return out + (total ? String(vlinenumAbsolute(total)) : '?');
      }
      return out + (content.length ? String(vlinenum(content.length)) : '?');
    case 'm':
      return out + (ntags() ? ntags() : files.list.length);

    case 'p':
      return out + (sizeIsKnown() && size > 0
        ? percentage(
          Math.min(
            absoluteByte(),
            size
          ),
          size
        )
        : '?');

    case 'P':
      if (!optLinenums()) return out + '?';
      if (hook.sourceLineCount) {
        const total = hook.sourceLineCount();
        if (total === undefined) {
          return out + String(percentage(row + 1, content.length));
        }
        return out + (total
          ? String(percentage(absoluteLine(), total))
          : '?');
      }
      return out + String(percentage(row + 1, content.length));

    case 'Q':
      return out + percentage(
        config.col + config.screenWidth,
        Math.max(longestLine(content), 1)
      );

    case 's': case 'B':
      return out + (sizeIsKnown() ? size : '?');
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
  const meta = lgetenv('LESSMETACHARS') ?? METACHARS;

  // the Windows shell has no backslash escaping, so og's
  // DEF_METAESCAPE is empty there and names quote-wrap instead
  const esc = lgetenv('LESSMETAESCAPE') ?? DEF_METAESCAPE;

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

/** Expands LESSEDIT for the regular session through the full prompt engine. */
export function editCommand(content: string[]): string {
  const proto = lgetenv('LESSEDIT') ?? '%E ?lm+%lm. %g';
  return prExpand(content, proto);
}

/**
 * Expands the edit-oriented prompt fields for a windowed file, whose
 * contents intentionally are not materialized into the regular file table.
 */
export function windowedEditCommand(
  filename: string,
  line: number | null
): string {
  const proto = lgetenv('LESSEDIT') ?? '%E ?lm+%lm. %g';
  const editor = lgetenv('VISUAL') || lgetenv('EDITOR') || EDIT_PGM;

  // LESSEDIT's usual ?lm... condition: include its body only when a
  // line number is known. Nested prompt conditionals are handled too.
  const conditionals = (text: string): string => {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '?' || text[i + 1] !== 'l' ||
          !'tmbBj'.includes(text[i + 2] ?? '')) {
        out += text[i];
        continue;
      }

      let depth = 1;
      let end = i + 3;
      for (; end < text.length; end++) {
        if (text[end] === '?' && text[end + 1] === 'l') depth++;
        else if (text[end] === '.' && --depth === 0) break;
      }
      if (line !== null) out += conditionals(text.slice(i + 3, end));
      i = end;
    }
    return out;
  };

  return conditionals(proto).replace(
    /%(%|E|[fgG]|l[tmbBj])/g,
    (_all, code: string) => {
      if (code === '%') return '%';
      if (code === 'E') return editor;
      if (code === 'f') return filename;
      if (code === 'g') return shellQuote(filename);
      if (code === 'G') return shellQuote(path.basename(filename));
      return line === null ? '?' : String(line);
    }
  );
}
