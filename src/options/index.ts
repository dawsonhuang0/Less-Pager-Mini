import fs from 'fs';

import { setPendingTag } from '../features/tags';

import { opt } from './state';


import { ringBell } from "../helpers";

import { cmd as cmdBuf, cmdOpen, cmdClose, cmdChar, cmdText,
  cmdSetText, cmdUngot } from "../features/cmdbuf";

import { parseLesskey, parseLesskeyBinary, parseLesskeyContent }
  from "../features/lesskey";

import { secureAllow } from "../features/secure";




import { search, chgCaseless } from "../features/searching";

import {
  setFirstCmd,
  setStartupLogFile
} from "../features/misc";



/**
 * Option value types, like opttbl.c: BOOL toggles, TRIPLE has lower and
 * upper states, NUMBER and STRING prompt for a parameter, NOVAR runs an
 * action.
 */
import { OptionSpec } from './spec';

import {
  prChar,
  setNoSearchHeaders,
  optScanError
} from './shared';

import { searchSkipScreen } from './search-skip-screen';
import { buffers } from './buffers';
import { autoBuffers } from './auto-buffers';
import { clearScreen } from './clear-screen';
import { dumb } from './dumb';
import { color } from './color';
import { quitAtEof } from './quit-at-eof';
import { force } from './force';
import { quitIfOneScreen } from './quit-if-one-screen';
import { hiliteSearch } from './hilite-search';
import { maxBackScroll } from './max-back-scroll';
import { ignoreCase } from './ignore-case';
import { ignoreCaseCaps } from './ignore-case-caps';
import { jumpTarget } from './jump-target';
import { statusColumn } from './status-column';
import { lesskeyFile } from './lesskey-file';
import { quitOnIntr } from './quit-on-intr';
import { noLessopen } from './no-lessopen';
import { longPrompt } from './long-prompt';
import { lineNumbers } from './line-numbers';
import { logFile } from './log-file';
import { logFileCaps } from './log-file-caps';
import { pattern } from './pattern';
import { prompt } from './prompt';
import { quiet } from './quiet';
import { rawControlChars } from './raw-control-chars';
import { squeezeBlankLines } from './squeeze-blank-lines';
import { chopLongLines } from './chop-long-lines';
import { tag } from './tag';
import { tagFile } from './tag-file';
import { underlineSpecial } from './underline-special';
import { version } from './version';
import { hiliteUnread } from './hilite-unread';
import { tabs } from './tabs';
import { noInit } from './no-init';
import { maxForwScroll } from './max-forw-scroll';
import { window } from './window';
import { quotes } from './quotes';
import { tilde } from './tilde';
import { help } from './help';
import { shift } from './shift';
import { noKeypad } from './no-keypad';
import { oldBot } from './old-bot';
import { followName } from './follow-name';
import { useBackslash } from './use-backslash';
import { rscroll } from './rscroll';
import { noHistdups } from './no-histdups';
import { mouse } from './mouse';
import { rmouse } from './rmouse';
import { wheelLines } from './wheel-lines';
import { saveMarks } from './save-marks';
import { lineNumWidth } from './line-num-width';
import { statusColWidth } from './status-col-width';
import { incsearch } from './incsearch';
import { useColor } from './use-color';
import { header } from './header';
import { noNumberHeaders } from './no-number-headers';
import { noSearchHeaders } from './no-search-headers';
import { noSearchHeaderLines } from './no-search-header-lines';
import { noSearchHeaderColumns } from './no-search-header-columns';
import { fileSize } from './file-size';
import { noVbell } from './no-vbell';
import { noEditWarn } from './no-edit-warn';
import { noShell } from './no-shell';
import { exitFollowOnClose } from './exit-follow-on-close';
import { showPreprocErrors } from './show-preproc-errors';
import { redrawOnQuit } from './redraw-on-quit';
import { noPaste } from './no-paste';
import { hiliteTarget } from './hilite-target';
import { intr } from './intr';
import { endPrompt } from './end-prompt';
import { cmd } from './cmd';
import { lesskeySrc } from './lesskey-src';
import { lesskeyContent } from './lesskey-content';
import { emouse } from './emouse';
import { searchOptions } from './search-options';
import { matchShift } from './match-shift';
import { autosave } from './autosave';
import { statusLine } from './status-line';
import { formFeed } from './form-feed';
import { pastEof } from './past-eof';
import { modelines } from './modelines';
import { procBackspace } from './proc-backspace';
import { procTab } from './proc-tab';
import { procReturn } from './proc-return';
import { wordwrap } from './wordwrap';

export * from './state';
export * from './shared';
export * from './spec';

const OPTIONS: OptionSpec[] = [
  // og's opttbl.c table order, entry for entry. It is not decoration:
  // findopts walks the table in order, so it decides which option an
  // ambiguous "--" prefix resolves to and the order TAB completion
  // offers the matches in. Our two extras sit beside their og
  // neighbours - -I with the -i it is the capital form of (og makes
  // them one TRIPLE entry), --no-shell after --no-edit-warn.
  searchSkipScreen,
  buffers,
  autoBuffers,
  clearScreen,
  dumb,
  color,
  quitAtEof,
  force,
  quitIfOneScreen,
  hiliteSearch,
  maxBackScroll,
  ignoreCase,
  ignoreCaseCaps,
  jumpTarget,
  statusColumn,
  lesskeyFile,
  lesskeyContent,
  lesskeySrc,
  quitOnIntr,
  noLessopen,
  longPrompt,
  lineNumbers,
  logFile,
  logFileCaps,
  pattern,
  prompt,
  quiet,
  rawControlChars,
  squeezeBlankLines,
  chopLongLines,
  tag,
  tagFile,
  underlineSpecial,
  version,
  hiliteTarget,
  hiliteUnread,
  tabs,
  noInit,
  maxForwScroll,
  window,
  quotes,
  tilde,
  help,
  shift,
  noKeypad,
  oldBot,
  followName,
  useBackslash,
  rscroll,
  noHistdups,
  mouse,
  emouse,
  rmouse,
  wheelLines,
  saveMarks,
  lineNumWidth,
  statusColWidth,
  incsearch,
  useColor,
  fileSize,
  statusLine,
  header,
  noPaste,
  formFeed,
  pastEof,
  noEditWarn,
  noShell,
  noNumberHeaders,
  noSearchHeaders,
  noSearchHeaderLines,
  noSearchHeaderColumns,
  redrawOnQuit,
  searchOptions,
  exitFollowOnClose,
  noVbell,
  modelines,
  intr,
  wordwrap,
  showPreprocErrors,
  procBackspace,
  procTab,
  procReturn,
  cmd,
  matchShift,
  autosave,
  endPrompt,
];





/**
 * Runtime option command state (`-`, `--`, `_`, `__`): pending command,
 * long name collection, parameter collection and the -+/-! modifier.
 */
export const option = {
  pending: '' as '' | '-' | '_',
  name: null as string | null,
  spec: null as OptionSpec | null,
  upper: false,
  param: '',
  flag: '' as '' | '+' | '!',

  /** True once the long name auto-completed to a unique option. */
  match: false,
  /** The long-name match and the typed first-char case. */
  matchSpec: null as OptionSpec | null,
  matchUpper: false,
  /** Suppresses the setting message, toggled by ^P (OPT_NO_PROMPT). */
  noPrompt: false,
  /** TAB completion candidates over long option names. */
  tabList: null as string[] | null,
  tabIdx: 0,
};

/**
 * Prefix-matches a typed long option name, like less's findopt_name:
 * sprefix accepts an uppercase-led name compared lowercased on a
 * triple, the longest match wins, an exact name beats later prefix
 * matches, and two same-length matches are ambiguous.
 *
 * @param typed - The name typed so far.
 * @returns The matched spec and completed display name, or nulls.
 */
function findOptName(
  typed: string
): { spec: OptionSpec | null, name: string | null, ambig: boolean } {
  let maxSpec: OptionSpec | null = null;
  let maxName: string | null = null;
  let maxLen = 0;
  let ambig = false;
  let exact = false;

  for (const spec of OPTIONS) {
    for (const specName of spec.names) {
      for (let uppercase = 0; uppercase <= 1; uppercase++) {
        const len = sprefix(typed, specName, uppercase > 0);

        // the typed name must not run past this option name
        if (len !== 0 && !isOptChar(typed[len])) {
          if (!exact && len === maxLen) {
            ambig = true;
          } else if (len > maxLen) {
            maxSpec = spec;
            maxName = uppercase ? specName.toUpperCase() : specName;
            maxLen = len;
            ambig = false;
            exact = len === specName.length;
          }
        }

        if (spec.type !== 'triple') break;
      }
    }
  }

  if (ambig) return { spec: null, name: null, ambig: true };
  return { spec: maxSpec, name: maxName, ambig: false };
}

/**
 * Lists the toggleable option names starting with a typed prefix for
 * TAB completion, like opttbl.c's findopts_name: triples also offer
 * their uppercase names.
 */
function findOptsName(prefix: string): string[] {
  const names: string[] = [];

  for (const spec of OPTIONS) {
    if (spec.noToggle) continue;

    for (const specName of spec.names) {
      for (let uppercase = 0; uppercase <= 1; uppercase++) {
        if (sprefix(prefix, specName, uppercase > 0) >= prefix.length) {
          names.push(uppercase ? specName.toUpperCase() : specName);
        }

        if (spec.type !== 'triple') break;
      }
    }
  }

  return names;
}

/**
 * Re-matches the typed long name, filling in a unique completion like
 * mca_opt_nonfirst_char's findopt_name + cmd_setstring.
 */
function matchTyped(): { spec: OptionSpec | null, ambig: boolean } {
  const typed = option.name ?? '';
  const found = findOptName(typed);

  if (found.spec !== null) {
    option.name = found.name;
    option.match = true;
    option.matchSpec = found.spec;
    option.matchUpper = !isLower(typed[0] ?? '');
  }

  return { spec: found.spec, ambig: found.ambig };
}

/**
 * Opens the option prompt.
 *
 * @param command - `-` to toggle an option, `_` to query its state.
 */
export function startOption(command: '-' | '_'): void {
  option.pending = command;
  option.name = null;
  option.spec = null;
  option.upper = false;
  option.param = '';
  option.flag = '';
  option.match = false;
  option.matchSpec = null;
  option.matchUpper = false;
  option.noPrompt = false;
  option.tabList = null;
  option.tabIdx = 0;
}

/**
 * Handles input following a `-` or `_` command.
 *
 * - A doubled `-`/`_` collects a long option name (`--chop-long-lines`),
 *   terminated by RETURN or `=` before an inline parameter.
 * - An uppercase long name selects a triple's second state, like less
 *   (`--QUIT-AT-EOF`).
 * - `-+` resets an option to its default, `-!` sets it, like less.
 * - Number and string options prompt for their parameter.
 *
 * @param content - Full content lines.
 * @param key - Raw key input following the option command.
 */
export function optionKey(content: string[], key: string): void {
  const command = option.pending;
  if (!command) return;

  const char = key[0];

  // collecting a parameter for a number/string option: og's
  // A_OPT_TOGGLE falls through to the common cmd_char line editing
  if (option.spec) {
    if (!cmdBuf.prefix) {
      if (char === '\x0D' || char === '\x0A') {
        const spec = option.spec;
        const param = cmdText();
        closeOption();
        applyParam(spec, param, content);
        return;
      }

      if (key === '\x03') {
        closeOption();
        return;
      }
    }

    const result = cmdChar(key);
    option.param = cmdText();

    // erasing past an empty buffer aborts, like cmd_char CC_QUIT
    if (result === 'quit') {
      closeOption();
      return;
    }

    for (let u = cmdUngot(); u !== null; u = cmdUngot()) {
      optionKey(content, u);
    }

    return;
  }

  // a second dash/underscore starts a long option name
  if (option.name === null && char === command) {
    option.name = '';
    cmdOpen(
      command + command + (option.noPrompt ? '(P)' : '') + option.flag
    );
    return;
  }

  // long option name collection, like mca_opt_nonfirst_char backed
  // by the cmd buffer's line editing
  if (option.name !== null) {
    if (!cmdBuf.prefix) {
      // an empty name buffer re-runs og's first-char dispatch
      // (mca_opt_char's `curropt == NULL && cmdbuf_empty()` gate):
      // extra dashes are swallowed, and the -+/-!/^P flags still
      // apply after the doubled dash
      if (cmdText() === '') {
        if (char === command) return;

        if (command === '-' && (char === '+' || char === '!')) {
          option.flag = option.flag === char ? '' : char;
          cmdOpen(command + command +
            (option.noPrompt ? '(P)' : '') + option.flag);
          return;
        }

        if (command === '-' && char === '\x10') {
          option.noPrompt = !option.noPrompt;
          cmdOpen(command + command +
            (option.noPrompt ? '(P)' : '') + option.flag);
          return;
        }
      }

      if (char === '\x0D' || char === '\x0A' || char === '=') {
        const name = option.name;
        const spec = option.matchSpec;
        const upper = option.matchUpper;
        cmdClose();
        option.name = null;
        option.match = false;
        option.matchSpec = null;
        option.tabList = null;

        if (!spec) {
          option.pending = '';
          search.message = `There is no --${name} option`;
          return;
        }

        if (char === '=' &&
            (spec.type === 'number' || spec.type === 'string')) {
          option.spec = spec;
          option.upper = upper;
          option.param = '';
          cmdOpen(spec.prompt ?? '');
          return;
        }

        applyOption(spec, upper, content);
        return;
      }

      if (key === '\x03') {
        closeName();
        return;
      }

      // TAB cycles the matching option names, like cmd_complete
      // stepping through findopts_name
      if (char === '\x09') {
        if (option.tabList === null) {
          const stem = option.name;
          const names = findOptsName(stem);

          if (!names.length) {
            ringBell();
            return;
          }

          option.tabList = [...names, stem];
          option.tabIdx = 0;
        } else {
          option.tabIdx = (option.tabIdx + 1) % option.tabList.length;
        }

        option.name = option.tabList[option.tabIdx];
        option.match = false;
        option.matchSpec = null;
        matchTyped();
        cmdSetText(option.name ?? '');
        return;
      }
    }

    // once the name completed, erase aborts the command and other
    // characters are swallowed (og's curropt != NULL branch)
    if (option.match) {
      if (char === '\x08' || char === '\x7F') closeName();
      return;
    }

    const before = cmdText();
    const result = cmdChar(key);
    option.name = cmdText();

    // erasing past an empty name aborts, like cmd_char CC_QUIT
    if (result === 'quit') {
      closeName();
      return;
    }

    if (cmdText() !== before) {
      option.tabList = null;
      const found = matchTyped();

      if (found.spec !== null) {
        // og displays the full matched name (cmd_setstring)
        cmdSetText(option.name ?? '');
      } else if (!found.ambig) {
        ringBell();
      }
    }

    for (let u = cmdUngot(); u !== null; u = cmdUngot()) {
      optionKey(content, u);
    }

    return;
  }

  // an interrupt or an unmapped escape sequence at the bare prompt
  // abandons the command
  if (key === '\x03' || key.startsWith('\x1B')) {
    startOption(command);
    option.pending = '';
    return;
  }

  // -+ resets to the default, -! sets, like mca_opt_first_char
  if (command === '-' && (char === '+' || char === '!')) {
    option.flag = option.flag === char ? '' : char;
    return;
  }

  // ^P toggles the setting message off, like OPT_NO_PROMPT
  if (command === '-' && char === '\x10') {
    option.noPrompt = !option.noPrompt;
    return;
  }

  // erasing the empty prompt aborts silently, like cmd_char CC_QUIT
  if (char === '\x08' || char === '\x7F') {
    option.pending = '';
    return;
  }

  // RETURN without an option letter, like toggle_option(NULL)
  if (char === '\x0D' || char === '\x0A') {
    option.pending = '';
    search.message = 'No such option';
    return;
  }

  const spec = OPTIONS.find(
    s => s.letter === char ||
      (s.type === 'triple' && s.letter !== '' &&
        s.letter === char.toLowerCase())
  );

  if (!spec) {
    option.pending = '';
    search.message = `There is no -${prChar(char)} option`;
    return;
  }

  applyOption(spec, char !== spec.letter, content);
}

/** Ends a parameter prompt and its cmd buffer. */
function closeOption(): void {
  cmdClose();
  option.pending = '';
  option.spec = null;
  option.param = '';
}

/** Ends a long-name prompt and its cmd buffer. */
function closeName(): void {
  cmdClose();
  option.pending = '';
  option.name = null;
  option.match = false;
  option.matchSpec = null;
  option.tabList = null;
}

/**
 * Toggles, sets or queries an option once it is identified.
 */
function applyOption(
  spec: OptionSpec,
  upper: boolean,
  content: string[]
): void {
  const command = option.pending;
  const flag = option.flag;
  option.pending = '';
  option.flag = '';

  const desc = optDesc(spec);

  // queries report the state or current value
  if (command === '_') {
    if (spec.noQuery) {
      search.message = `Cannot query the ${desc} option`;
      return;
    }

    if (spec.query) {
      spec.query();
      return;
    }

    if (spec.type === 'novar') {
      spec.set(0, content);
    } else if (spec.type === 'number') {
      search.message = spec.report!.replace('%d', String(spec.get()));
    } else if (spec.type === 'string') {
      search.message = String(spec.get());
    } else {
      search.message = spec.messages[stateOf(spec)];
    }

    return;
  }

  if (spec.noToggle) {
    search.message = `Cannot change the ${desc} option`;
    return;
  }

  if (spec.type === 'novar') {
    spec.set(0, content);
    return;
  }

  if (spec.type === 'string' && (flag === '+' || flag === '!')) {
    search.message = 'Cannot use "-+" or "-!" for a string option';
    return;
  }

  if (spec.type === 'number' && flag === '!') {
    search.message = 'Can\'t use "-!" for a numeric option';
    return;
  }

  if (spec.type === 'number' || spec.type === 'string') {
    if (spec.enter) {
      spec.enter();
      return;
    }

    if (flag === '+') {
      spec.set(spec.defaultValue, content);

      if (!option.noPrompt) {
        search.message = spec.report!.replace('%d', String(spec.get()));
      }

      return;
    }

    option.pending = command;
    option.spec = spec;
    option.upper = upper;
    option.param = '';
    cmdOpen(spec.prompt ?? '');
    return;
  }

  const target = spec.type === 'triple' ? (upper ? 2 : 1) : 1;
  const current = spec.get() as number;

  let next: number;

  if (flag === '+') {
    next = spec.defaultValue as number;
  } else if (flag === '!') {
    // og's OPT_SET is the inverse of the default, not the target
    // state: flip_triple(odefault, lower) / !odefault
    next = spec.type === 'triple'
      ? flipTriple(spec.defaultValue as number, !upper)
      : (spec.defaultValue as number) ? 0 : 1;
  } else {
    next = current === target ? 0 : target;
  }

  spec.set(next, content);
  if (!option.noPrompt) search.message = spec.messages[stateOf(spec)];
}

/**
 * Applies a collected number/string parameter.
 */
function applyParam(
  spec: OptionSpec,
  param: string,
  content: string[]
): void {
  // an empty parameter turns the toggle into a query, like
  // toggle_option downgrading OPT_TOGGLE to OPT_NO_TOGGLE
  if (param === '') {
    if (spec.type === 'number') {
      search.message = spec.report!.replace('%d', String(spec.get()));
    } else if (spec.query) {
      spec.query();
    } else if (!spec.noQuery) {
      search.message = String(spec.get());
    }

    return;
  }

  if (spec.type === 'string') {
    const before = search.message;
    spec.set(param, content);

    // og's toggle_option reports the query message after setting a
    // string option; a handler error shows first, the state after
    if (!spec.noQuery && !option.noPrompt) {
      if (search.message === before) {
        if (spec.query) {
          spec.query();
        } else {
          search.message = String(spec.get());
        }
      } else {
        search.messageQueue.push(String(spec.get()));
      }
    }

    return;
  }

  const value = parseInt(param, 10);

  if (isNaN(value) || (value < 0 && !spec.negok)) {
    search.message = value < 0 && !spec.negok
      ? `Negative number not allowed in ${optDesc(spec)}`
      : `Number is required after ${optDesc(spec)}`;
    return;
  }

  if (value > 0x7FFFFFFF) {
    search.message = `Number too large in ${optDesc(spec)}`;
    return;
  }

  if (spec.max !== undefined && value > spec.max) {
    // og prints the limit error from the handler, then the regular
    // report with the fallback value
    spec.set(spec.maxFallback!, content);
    search.message = spec.maxMessage!.replace('%d', String(spec.max));

    if (!option.noPrompt) {
      search.messageQueue.push(
        spec.report!.replace('%d', String(spec.get()))
      );
    }

    return;
  }

  spec.set(value, content);

  // og calls the option handler at TOGGLE before printing the report
  if (spec.handler) spec.handler();

  if (!option.noPrompt) {
    search.message = spec.report!.replace('%d', String(spec.get()));
  }
}

/**
 * Returns a bool/triple option's current state for messages.
 */
function stateOf(spec: OptionSpec): number {
  if (spec.letter === 'i' || spec.letter === 'I') return search.caseless;
  return spec.get() as number;
}


// ---------------------------------------------------------------------
// $LESS startup options, ported from option.c's scan_option
// ---------------------------------------------------------------------

/** What the $LESS scan tells the pager to do at startup. */
interface StartupCmds {
  /** `+`/`-p` commands replayed at the first file, in order. */
  firstCmds: string[];
  /** True when `-?`/`--help` pages the help file first (og's dohelp). */
  dohelp: boolean;
  /** True when -V printed the version: the pager must not start. */
  version: boolean;
}

const isUpper = (c: string): boolean => c >= 'A' && c <= 'Z';
const isLower = (c: string): boolean => c >= 'a' && c <= 'z';
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** True for characters that can extend an option name (is_optchar). */
const isOptChar = (c: string | undefined): boolean =>
  c !== undefined && (isUpper(c) || isLower(c) || c === '-');

/** Prints an option's name for messages, like option.c's opt_desc. */
const optDesc = (spec: OptionSpec): string =>
  spec.letter ? `-${spec.letter} (--${spec.names[0]})` : `--${spec.names[0]}`;


/**
 * Counts matching leading characters of a typed name against an option
 * name, like main.c's sprefix: with uppercase, the typed name must
 * start with an uppercase letter and compares lowercased; uppercase
 * option name characters after the first also compare lowercased.
 */
function sprefix(typed: string, name: string, uppercase: boolean): number {
  let len = 0;

  for (; len < name.length; len++) {
    let c = typed[len];
    if (c === undefined) break;

    if (uppercase) {
      if (len === 0 && isLower(c)) return 0;
      if (isUpper(c)) c = c.toLowerCase();
    }

    let sc = name[len];
    if (len > 0 && isUpper(sc)) sc = sc.toLowerCase();

    if (c !== sc) break;
  }

  return len;
}

/**
 * Finds the long option starting a $LESS remainder, like opttbl.c's
 * findopt_name: the longest match wins, names may abbreviate as long
 * as the next character could not extend a name, and a second pass
 * accepts an uppercase-led name compared lowercased, which selects a
 * triple's second state through the typed case (--Quit-at-eof).
 */
function findScanName(
  typed: string
): { spec: OptionSpec | null, len: number, ambig: boolean } {
  let maxSpec: OptionSpec | null = null;
  let maxLen = 0;
  let ambig = false;
  let exact = false;

  for (const spec of OPTIONS) {
    for (const name of spec.names) {
      for (let uppercase = 0; uppercase <= 1; uppercase++) {
        const len = sprefix(typed, name, uppercase > 0);

        // the typed name went past this option name
        if (len === 0 || isOptChar(typed[len])) continue;

        if (!exact && len === maxLen) {
          ambig = true;
        } else if (len > maxLen) {
          maxSpec = spec;
          maxLen = len;
          ambig = false;
          exact = len === name.length;
        }

        // og only skips the uppercase pass once the first matched
        if (spec.type !== 'triple') break;
      }
    }
  }

  if (ambig) return { spec: null, len: 0, ambig: true };
  return { spec: maxSpec, len: maxLen, ambig: false };
}

/**
 * Collects a string option's parameter, like option.c's optstring: `$`
 * ends the parameter, --use-backslash escapes the next character, and
 * validchars limits what the string may contain.
 *
 * @returns The parameter and the index of its terminator, or null
 *          after the missing-value message.
 */
function optString(
  text: string,
  at: number,
  printopt: string,
  validchars?: string
): { param: string, next: number } | null {
  if (at >= text.length) {
    // silent for the argument-classification probe
    if (printopt) optScanError(`Value is required after ${printopt}`);
    return null;
  }

  let param = '';
  let vi = 0;
  let i = at;

  for (; i < text.length; i++) {
    let c = text[i];

    if (opt.useBackslash && c === '\\' && i + 1 < text.length) {
      c = text[++i];
    } else {
      if (validchars !== undefined) {
        if (validchars[vi] === 's') {
          if (c === ' ') break;
        } else if (c === '-') {
          if (validchars[vi] !== '-') break;
          vi++;
        } else if (c === '.') {
          if (validchars[vi] === '-') vi++;
          if (validchars[vi] !== '.') break;
          vi++;
        } else if (c === ',') {
          if (vi >= validchars.length || validchars[vi + 1] !== ',') break;
        } else if (isDigit(c)) {
          while (validchars[vi] === '-' || validchars[vi] === '.') vi++;
          if (validchars[vi] !== 'd') break;
        } else {
          break;
        }
      }

      if (c === '$') break;
    }

    param += c;
  }

  return { param, next: i };
}

/**
 * Parses a number in the option string, like option.c's getnumc: on a
 * missing or negative number the scan resumes at the same spot, after
 * an overflow it resumes past the digits.
 *
 * @returns The value (null after a message) and the resume index.
 */
function getNum(
  text: string,
  at: number,
  printopt: string,
  negok: boolean
): { value: number | null, next: number } {
  let i = at;
  while (text[i] === ' ' || text[i] === '\t') i++;

  let neg = false;

  if (text[i] === '-') {
    if (!negok) {
      // og's num_error stays silent for a null printopt
      if (printopt) {
        optScanError(`Negative number not allowed in ${printopt}`);
      }

      return { value: null, next: at };
    }

    neg = true;
    i++;
  }

  if (!isDigit(text[i] ?? '')) {
    if (printopt) optScanError(`Number is required after ${printopt}`);
    return { value: null, next: at };
  }

  let value = 0;
  let overflow = false;

  for (; isDigit(text[i] ?? ''); i++) {
    value = value * 10 + (text.charCodeAt(i) - 0x30);
    if (value > 0x7FFFFFFF) overflow = true;
  }

  if (overflow) {
    if (printopt) optScanError(`Number too large in ${printopt}`);
    return { value: null, next: i };
  }

  return { value: neg ? -value : value, next: i };
}

/** "Toggles" a triple at INIT, like option.c's flip_triple. */
const flipTriple = (val: number, lc: boolean): number =>
  lc ? (val === 1 ? 0 : 1) : (val === 2 ? 0 : 2);

/**
 * Applies a string option at INIT; a few handlers act differently at
 * startup than at a runtime toggle, like optfunc.c's INIT cases.
 */
function applyScanString(
  spec: OptionSpec,
  param: string,
  content: string[],
  result: StartupCmds
): void {
  // -p ungets a search for the pattern as the first command (opt_p);
  // in "more" mode it is a command for every file, not a search
  if (spec.letter === 'p') {
    if (opt.lessIsMore) {
      setFirstCmd(param);
    } else {
      result.firstCmds.push('/' + param);
    }

    return;
  }

  // -o/-O store the log file to open when input is piped in (opt_o)
  if (spec.letter === 'o' || spec.letter === 'O') {
    setStartupLogFile(param, spec.letter === 'O');
    return;
  }

  // --lesskey-src and --lesskey-content parse at startup (opt_ks/kc);
  // -k names the binary lesskey format, which is not supported
  if (spec.names[0] === 'lesskey-content') {
    // og's parse_lesskey_content: semicolons separate lines. opt_kc
    // reports a summary of its own when the parse found anything
    // wrong, on top of the per-line messages (optfunc.c:322)
    if (parseLesskeyContent(param) !== 0) {
      optScanError('Error in lesskey content');
    }

    return;
  }

  if (spec.names[0] === 'lesskey-src') {
    try {
      // og's lesskey_src returns the ERROR COUNT, so opt_ks reports
      // this for a file that parsed badly, not only one it could not
      // read (optfunc.c:307)
      if (parseLesskey(fs.readFileSync(param, 'utf8'), param) !== 0) {
        optScanError(`Cannot use lesskey source file "${param}"`);
      }
    } catch {
      optScanError(`Cannot use lesskey source file "${param}"`);
    }

    return;
  }

  // -k loads a compiled lesskey file at INIT, like opt_k calling
  // lesskey(s, 0); any failure reports og's message (optfunc.c:293)
  if (spec.letter === 'k') {
    try {
      if (!secureAllow('lesskey')) throw new Error('secure');
      parseLesskeyBinary(fs.readFileSync(param));
    } catch {
      optScanError(`Cannot use lesskey file "${param}"`);
    }

    return;
  }

  // -t only RECORDS the tag at startup: og's opt_t INIT is
  // `tagoption = save(s)` with the comment "Do the rest in main()",
  // and main.c looks the tag up at line 408, after every option has
  // been scanned. Doing it here instead made the lookup depend on
  // argument order -- `-t tag -T file` could not see the -T yet and
  // failed with "No tags file", while og handles either order.
  if (spec.letter === 't') {
    setPendingTag(param.replace(/^[ \t]+/, ''));
    return;
  }

  // -T stores the name unexpanded at startup, like opt__T's INIT
  // (save(s)); only a runtime toggle runs the lglob expansion
  if (spec.letter === 'T') {
    opt.tagsFile = param;
    return;
  }

  spec.set(param, content);
}

/** Marks -i and -I together, since og folds them into one triple. */
function markUnsupported(spec: OptionSpec): void {
  spec.unsupported = true;

  if (spec.letter === 'i' || spec.letter === 'I') {
    const other = spec.letter === 'i' ? 'I' : 'i';
    const pair = OPTIONS.find(s => s.letter === other);
    if (pair) pair.unsupported = true;
  }
}

/**
 * Marks the $LESS_UNSUPPORT options as ignored by the $LESS scan,
 * like option.c's init_unsupport: entries are option letters or long
 * names, each optionally preceded by dashes.
 */
export function initUnsupport(env: string): void {
  for (const spec of OPTIONS) spec.unsupported = false;

  let i = 0;

  while (i < env.length) {
    while (env[i] === ' ' || env[i] === '\t') i++;
    if (i >= env.length) break;

    // one leading dash is skipped; a second starts a long name
    if (env[i] === '-') {
      if (++i >= env.length) break;
    }

    if (env[i] === '-') {
      const found = findScanName(env.slice(i + 1));

      if (found.spec !== null) {
        markUnsupported(found.spec);
        i += 1 + found.len;
      } else {
        i++;
      }
    } else {
      const c = env[i++];
      const spec = OPTIONS.find(s => s.letter === c || (
        s.type === 'triple' && s.letter !== '' &&
          s.letter.toUpperCase() === c
      ));

      if (spec) markUnsupported(spec);
    }
  }
}

// a string/number option that ran out of characters waits for the
// next scan_option call to supply its parameter, like og's pendopt
let scanPendopt: OptionSpec | null = null;

/**
 * Reports a still-dangling option after all startup scans, like og's
 * main calling nopendopt() when isoptpending() survives the argv loop.
 */
export function flushPendopt(): void {
  if (scanPendopt === null) return;

  optScanError(`Value is required after ${optDesc(scanPendopt)}`);
  scanPendopt = null;
}

/** Prints an option's name for messages (option.c's opt_desc). */
export const optionDesc = (spec: OptionSpec): string => optDesc(spec);

/** The full option table, for the API type generator and its guard. */
export const optionSpecs = (): OptionSpec[] => OPTIONS;

/**
 * Walks one command line argument the way scan_option consumes it and
 * returns the option left waiting for a value, like og's isoptpending
 * classifying the next argv string as a parameter rather than a file.
 * Nothing is applied and no messages print.
 *
 * @param arg - The command line argument.
 * @param pending - The option dangling from the previous argument.
 * @param seen - Called with each option the argument names.
 */
export function optionArgPending(
  arg: string,
  pending: OptionSpec | null,
  seen?: (spec: OptionSpec) => void
): OptionSpec | null {
  // the whole argument is the pending option's parameter
  if (pending !== null) return null;

  let i = 0;

  while (i < arg.length) {
    let optc = arg[i++];
    let longName = false;

    if (optc === ' ' || optc === '\t' || optc === '$') continue;

    if (optc === '-') {
      if (arg[i] === '-') {
        i++;
        longName = true;
      }

      if (arg[i] === '+') i++;
      if (!longName) continue;
    } else if (optc === '+') {
      // a +cmd consumes the rest of the argument
      return null;
    } else if (isDigit(optc)) {
      i--;
      optc = 'z';
    } else if (optc === 'n' && opt.lessIsMore) {
      optc = 'z';
    }

    let spec: OptionSpec | undefined;

    if (!longName) {
      spec = OPTIONS.find(s => s.letter === optc || (
        s.type === 'triple' && s.letter !== '' &&
          s.letter.toUpperCase() === optc
      ));

      // the real scan stops with an error here
      if (!spec) return null;
    } else {
      const found = findScanName(arg.slice(i));
      if (found.spec === null) return null;

      i += found.len;
      spec = found.spec;

      if (arg[i] === '=') {
        if (spec.type !== 'number' && spec.type !== 'string') return null;
        i++;
      } else if (i < arg.length && arg[i] !== ' ') {
        return null;
      }
    }

    if (seen) seen(spec);

    if (spec.type !== 'number' && spec.type !== 'string') continue;

    // a value-less string/number option at the end waits for the
    // next argument
    if (i >= arg.length) return spec;

    if (spec.type === 'string') {
      while (arg[i] === ' ') i++;

      const str = optString(arg, i, '', spec.validchars);
      if (str === null) return null;

      i = str.next;
    } else {
      i = getNum(arg, i, '', spec.negok === true).next;
    }
  }

  return null;
}

// command line option strings handed over by the lmn CLI; og scans
// each argv string with its own scan_option call after $LESS
let cliOptions: string[] = [];

/** Stores the CLI option strings for the next session's scan. */
export function setCliOptions(args: string[]): void {
  cliOptions = args;
}

/** Takes (and clears) the pending CLI option strings. */
export function takeCliOptions(): string[] {
  const args = cliOptions;
  cliOptions = [];
  return args;
}

/**
 * Applies the $LESS environment options at startup, like option.c's
 * scan_option with INIT semantics: no-toggle options may be set, string
 * and number parameters follow their option (`$` terminates a string),
 * `-+x` resets to the default, `+cmd` queues commands for the first
 * file (`++cmd` for every file), and `-r` acts as `-R` only in the
 * environment (og's is_env), not in a command line argument.
 *
 * @param env - The $LESS string (or one command line argument).
 * @param content - Full content lines for display-affecting setters.
 * @param isEnv - False for a command line argument.
 * @returns Commands and flags the pager applies at startup.
 */
/**
 * Does this option string ASK for --no-shell?
 *
 * A read-only walk over the same name matching scan_option uses, for
 * deciding whether an environment demands the safety flag. It must
 * not be the real scan: running that twice would re-apply handlers
 * with side effects of their own (a --lesskey-content would load its
 * bindings again), and this string may never be scanned at all.
 *
 * A `+` reset (`--+no-shell`) is not a request, it is the opposite.
 *
 * @param text - An option string, like a $LESS value.
 */
export function requestsNoShell(text: string): boolean {
  let i = 0;

  while (i < text.length) {
    const ch = text[i++];

    if (ch !== '-') continue;
    if (text[i] !== '-') continue;

    i++;

    // "--+name" resets to the default: the opposite of a request
    if (text[i] === '+') {
      i++;
      continue;
    }

    const found = findScanName(text.slice(i));

    if (found.spec !== null && !found.ambig) {
      if (found.spec.names.includes('no-shell')) return true;
      i += found.len;
    }
  }

  return false;
}

export function scanOptions(
  env: string,
  content: string[],
  isEnv: boolean = true
): StartupCmds {
  const result: StartupCmds = { firstCmds: [], dohelp: false, version: false };
  let setDefault = false;
  let i = 0;

  // a pending option takes this whole call's string as its value,
  // like og's scan_option consuming the next argument for pendopt
  if (scanPendopt !== null) {
    const spec = scanPendopt;
    scanPendopt = null;

    if (!spec.unsupported) {
      if (spec.type === 'string') {
        // og hands the raw argument to the handler, without the
        // optstring $/validchars processing
        applyScanString(spec, env, content, result);
      } else {
        // og writes the number straight into the variable without
        // calling the option handler, so no clamping happens here
        const num = getNum(env, 0, optDesc(spec), spec.negok === true);
        if (num.value !== null) spec.set(num.value, content);
      }
    }

    return result;
  }

  while (i < env.length) {
    let optc = env[i++];
    let longName = false;

    if (optc === ' ' || optc === '\t' || optc === '$') continue;

    if (optc === '-') {
      // "--" starts an option name; "-+"/"--+" resets to the default
      if (env[i] === '-') {
        i++;
        longName = true;
      }

      setDefault = env[i] === '+';
      if (setDefault) i++;

      if (!longName) continue;
    } else if (optc === '+') {
      // a "+cmd" option is processed at the start of the first input
      // file, "++cmd" at the start of every input file
      const str = optString(env, i, '-+');
      if (str === null) return result;

      i = str.next;

      if (str.param.startsWith('+')) {
        setFirstCmd(str.param.slice(1));
      } else {
        result.firstCmds.push(str.param);
      }

      continue;
    } else if (isDigit(optc)) {
      // "more" compatibility: "-<number>" sets the -z window size
      i--;
      optc = 'z';
    } else if (optc === 'n' && opt.lessIsMore) {
      // more's -n is the -z window size
      optc = 'z';
    }

    let spec: OptionSpec | undefined;
    let lc: boolean;
    let printopt: string;

    if (!longName) {
      printopt = '-' + prChar(optc);
      lc = isLower(optc);

      spec = OPTIONS.find(s => s.letter === optc || (
        s.type === 'triple' && s.letter !== '' &&
          s.letter.toUpperCase() === optc
      ));

      if (!spec) {
        optScanError(
          `There is no ${printopt} option ("less --help" for help)`
        );
        return result;
      }
    } else {
      // og reports the raw remainder when a long name goes wrong
      const rest = env.slice(i);
      printopt = rest;
      lc = isLower(rest[0] ?? '');

      const found = findScanName(rest);

      if (found.spec === null) {
        optScanError(found.ambig
          ? `--${rest} is an ambiguous abbreviation ("less --help" for help)`
          : `There is no --${rest} option ("less --help" for help)`);
        return result;
      }

      i += found.len;
      spec = found.spec;

      if (env[i] === '=') {
        if (spec.type !== 'number' && spec.type !== 'string') {
          optScanError(
            `The --${rest} option should not be followed by =`
          );
          return result;
        }

        i++;
      } else if (i < env.length && env[i] !== ' ') {
        // the typed name is longer than the real option name
        optScanError(
          `There is no --${rest} option ("less --help" for help)`
        );
        return result;
      }
    }

    // a $LESS_UNSUPPORT option parses but is ignored: og consumes a
    // string parameter yet leaves number digits to rescan
    if (spec.unsupported) {
      if (spec.type === 'number' || spec.type === 'string') {
        if (i >= env.length) {
          // wait for the next argument, like og's pendopt
          scanPendopt = spec;
          return result;
        }
      }

      if (spec.type === 'string') {
        while (env[i] === ' ') i++;

        const str = optString(env, i, printopt, spec.validchars);
        if (str === null) return result;

        i = str.next;
      }

      continue;
    }

    // -V prints the version and quits, -? pages help (opt__V/opt_query)
    if (spec.letter === 'V') {
      result.version = true;
      return result;
    }

    if (spec.letter === '?') {
      result.dohelp = true;
      continue;
    }

    if (spec.type === 'bool') {
      // og folds -i/-I into one triple over caseless
      if (spec.letter === 'i' || spec.letter === 'I') {
        chgCaseless(setDefault ? 0 : lc ? 1 : 2);
        continue;
      }

      const def = spec.defaultValue as number;
      spec.set(setDefault ? def : def ? 0 : 1, content);
      continue;
    }

    if (spec.type === 'triple') {
      let value: number;

      if (setDefault) {
        value = spec.defaultValue as number;
      } else if (isEnv && spec.letter === 'r') {
        // if -r appears in an env var, treat it as -R
        value = 2;
      } else {
        value = flipTriple(spec.defaultValue as number, lc);
      }

      spec.set(value, content);
      continue;
    }

    if (spec.type === 'novar') {
      // INIT handlers set their state silently (do_nosearch_headers)
      if (spec.names[0] === 'no-search-headers') setNoSearchHeaders(1, 1);
      if (spec.names[0] === 'no-search-header-lines') setNoSearchHeaders(1, 0);
      if (spec.names[0] === 'no-search-header-columns') {
        setNoSearchHeaders(0, 1);
      }

      continue;
    }

    // a string/number option ending the string waits for the next
    // scan call's argument, like og's pendopt; flushPendopt reports
    // it when nothing follows (og's nopendopt)
    if (i >= env.length) {
      scanPendopt = spec;
      return result;
    }

    if (spec.type === 'string') {
      while (env[i] === ' ') i++;

      const str = optString(env, i, printopt, spec.validchars);
      if (str === null) return result;

      i = str.next;
      applyScanString(spec, str.param, content, result);
      continue;
    }

    const num = getNum(env, i, printopt, spec.negok === true);
    i = num.next;
    if (num.value === null) continue;

    if (spec.max !== undefined && num.value > spec.max) {
      optScanError(spec.maxMessage!.replace('%d', String(spec.max)));
      spec.set(spec.maxFallback!, content);
    } else {
      spec.set(num.value, content);
    }

    // an attached value runs the option handler (og's INIT call)
    if (spec.handler) spec.handler();
  }

  return result;
}
