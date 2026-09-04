// GENERATED FILE - do not edit. Snapshot of buildLessOptionMap over
// the live option table (src/options), with each key's description
// taken from less's --help text and its default from the option table.
// Regenerate with `npm run gen:options`; tests/misc/api.test.ts fails
// until the snapshot matches the table again.

/** Every less option key the pager options object accepts. */
export const LESS_OPTION_VALUES = {
  'search-skip-screen': 'flag',
  'SEARCH-SKIP-SCREEN': 'flag',
  buffers: 'value',
  'auto-buffers': 'flag',
  'clear-screen': 'flag',
  'CLEAR-SCREEN': 'flag',
  dumb: 'flag',
  color: 'value',
  'quit-at-eof': 'flag',
  'QUIT-AT-EOF': 'flag',
  force: 'flag',
  'quit-if-one-screen': 'flag',
  'hilite-search': 'flag',
  'HILITE-SEARCH': 'flag',
  'max-back-scroll': 'value',
  'ignore-case': 'flag',
  'IGNORE-CASE': 'flag',
  'jump-target': 'value',
  'status-column': 'flag',
  'lesskey-file': 'value',
  'lesskey-content': 'value',
  'lesskey-src': 'value',
  'quit-on-intr': 'flag',
  'no-lessopen': 'flag',
  'long-prompt': 'flag',
  'LONG-PROMPT': 'flag',
  'line-numbers': 'flag',
  'LINE-NUMBERS': 'flag',
  'log-file': 'value',
  'LOG-FILE': 'value',
  pattern: 'value',
  prompt: 'value',
  quiet: 'flag',
  QUIET: 'flag',
  silent: 'flag',
  SILENT: 'flag',
  'raw-control-chars': 'flag',
  'RAW-CONTROL-CHARS': 'flag',
  'squeeze-blank-lines': 'flag',
  'chop-long-lines': 'flag',
  tag: 'value',
  'tag-file': 'value',
  'underline-special': 'flag',
  'UNDERLINE-SPECIAL': 'flag',
  version: 'flag',
  'hilite-target': 'flag',
  'hilite-unread': 'flag',
  'HILITE-UNREAD': 'flag',
  tabs: 'value',
  'no-init': 'flag',
  'max-forw-scroll': 'value',
  window: 'value',
  quotes: 'value',
  tilde: 'flag',
  help: 'flag',
  'lesskey-help': 'flag',
  'view-lesskey': 'flag',
  shift: 'value',
  'no-keypad': 'flag',
  'old-bot': 'flag',
  'follow-name': 'flag',
  'use-backslash': 'flag',
  rscroll: 'value',
  'no-histdups': 'flag',
  mouse: 'flag',
  MOUSE: 'flag',
  emouse: 'value',
  rmouse: 'flag',
  'wheel-lines': 'value',
  'save-marks': 'flag',
  'line-num-width': 'value',
  'status-col-width': 'value',
  incsearch: 'flag',
  'use-color': 'flag',
  'use-js-regexp': 'flag',
  'use-gnu-regexp': 'flag',
  'use-zsh-glob': 'flag',
  'file-size': 'flag',
  'status-line': 'flag',
  header: 'value',
  'no-paste': 'flag',
  'form-feed': 'flag',
  'past-eof': 'flag',
  'no-edit-warn': 'flag',
  'no-warn-edit': 'flag',
  'no-number-headers': 'flag',
  'no-search-headers': 'flag',
  'no-search-header-lines': 'flag',
  'no-search-header-columns': 'flag',
  'redraw-on-quit': 'flag',
  'search-options': 'value',
  'exit-follow-on-close': 'flag',
  'no-vbell': 'flag',
  modelines: 'value',
  intr: 'value',
  wordwrap: 'flag',
  'show-preproc-errors': 'flag',
  'proc-backspace': 'flag',
  'PROC-BACKSPACE': 'flag',
  'proc-tab': 'flag',
  'PROC-TAB': 'flag',
  'proc-return': 'flag',
  'PROC-RETURN': 'flag',
  cmd: 'value',
  'match-shift': 'value',
  autosave: 'value',
  'end-prompt': 'value',
} as const;

/**
 * less option keys, typed: flags take a boolean, the rest a value.
 * Spelled out rather than mapped over LESS_OPTION_VALUES so each key
 * carries its own doc comment — the editor shows the description and
 * the default as you pick the name out of the completion list.
 *
 * A flag left out keeps less's startup state, which for nearly every
 * option means off; the exceptions are less's own inverted names (-B
 * --auto-buffers, -G --HILITE-SEARCH). Only value options carry an
 * @default, since a triple's table state does not map onto one key's
 * boolean.
 */
export interface LessOptions {
  /** Search skips current screen. */
  'search-skip-screen'?: boolean;
  /** Search starts just after target line. */
  'SEARCH-SKIP-SCREEN'?: boolean;
  /** Number of buffers. @default 64 */
  buffers?: number | string;
  /** Don't automatically allocate buffers for pipes. */
  'auto-buffers'?: boolean;
  /** Repaint by clearing rather than scrolling. */
  'clear-screen'?: boolean;
  /** Repaint by clearing rather than scrolling. */
  'CLEAR-SCREEN'?: boolean;
  /** Dumb terminal. */
  dumb?: boolean;
  /** Set screen colors. */
  color?: number | string;
  /** Quit at end of file. */
  'quit-at-eof'?: boolean;
  /** Quit at end of file. */
  'QUIT-AT-EOF'?: boolean;
  /** Force open non-regular files. */
  force?: boolean;
  /** Quit if entire file fits on first screen. */
  'quit-if-one-screen'?: boolean;
  /** Highlight only last match for searches. */
  'hilite-search'?: boolean;
  /** Don't highlight any matches for searches. */
  'HILITE-SEARCH'?: boolean;
  /** Backward scroll limit. @default -1 */
  'max-back-scroll'?: number | string;
  /** Ignore case in searches that do not contain uppercase. */
  'ignore-case'?: boolean;
  /** Ignore case in all searches. */
  'IGNORE-CASE'?: boolean;
  /** Screen position of target lines. @default '0' */
  'jump-target'?: number | string;
  /** Display a status column at left edge of screen. */
  'status-column'?: boolean;
  /** Use a compiled lesskey file. */
  'lesskey-file'?: number | string;
  /** A less option. */
  'lesskey-content'?: number | string;
  /** Use a lesskey source file. */
  'lesskey-src'?: number | string;
  /** Exit less-pager-mini in response to ctrl-C. */
  'quit-on-intr'?: boolean;
  /** Ignore the LESSOPEN environment variable. */
  'no-lessopen'?: boolean;
  /** Set prompt style. */
  'long-prompt'?: boolean;
  /** Set prompt style. */
  'LONG-PROMPT'?: boolean;
  /** Suppress line numbers in prompts and messages. */
  'line-numbers'?: boolean;
  /** Display line number at start of each line. */
  'LINE-NUMBERS'?: boolean;
  /** Copy to log file (standard input only). */
  'log-file'?: number | string;
  /** Copy to log file (unconditionally overwrite). */
  'LOG-FILE'?: number | string;
  /** Start at pattern (from command line). */
  pattern?: number | string;
  /** Define new prompt. */
  prompt?: number | string;
  /** Quiet the terminal bell. */
  quiet?: boolean;
  /** Quiet the terminal bell. */
  QUIET?: boolean;
  /** Quiet the terminal bell. */
  silent?: boolean;
  /** Quiet the terminal bell. */
  SILENT?: boolean;
  /** Output "raw" control characters. */
  'raw-control-chars'?: boolean;
  /** Output "raw" control characters. */
  'RAW-CONTROL-CHARS'?: boolean;
  /** Squeeze multiple blank lines. */
  'squeeze-blank-lines'?: boolean;
  /** Chop (truncate) long lines rather than wrapping. */
  'chop-long-lines'?: boolean;
  /** Find a tag. */
  tag?: number | string;
  /** Use an alternate tags file. @default 'tags' */
  'tag-file'?: number | string;
  /** Change handling of backspaces, tabs and carriage returns. */
  'underline-special'?: boolean;
  /** Change handling of backspaces, tabs and carriage returns. */
  'UNDERLINE-SPECIAL'?: boolean;
  /** Display the version number of "less-pager-mini". */
  version?: boolean;
  /** Highlight the target line. */
  'hilite-target'?: boolean;
  /** Highlight first new line after full screen movement. */
  'hilite-unread'?: boolean;
  /** Highlight first new line after any movement. */
  'HILITE-UNREAD'?: boolean;
  /** Set tab stops. */
  tabs?: number | string;
  /** Don't use termcap init/deinit strings. */
  'no-init'?: boolean;
  /** Forward scroll limit. @default -1 */
  'max-forw-scroll'?: number | string;
  /** Set size of window. @default -1 */
  window?: number | string;
  /** Set shell quote characters. @default '"' */
  quotes?: number | string;
  /** Don't display tildes after end of file. */
  tilde?: boolean;
  /** Display help (from command line). */
  help?: boolean;
  /** Display lesskey help. */
  'lesskey-help'?: boolean;
  /** View lesskeys in use. */
  'view-lesskey'?: boolean;
  /** Set horizontal scroll amount (0 = one half screen width). @default '0' */
  shift?: number | string;
  /** Don't send termcap keypad init/deinit strings. */
  'no-keypad'?: boolean;
  /** Use old bottom of screen behavior. */
  'old-bot'?: boolean;
  /** The F command changes files if the input file is renamed. */
  'follow-name'?: boolean;
  /** Subsequent options use backslash as escape char. */
  'use-backslash'?: boolean;
  /** Set the character used to mark truncated lines. @default '>' */
  rscroll?: number | string;
  /** Remove duplicates from command history. */
  'no-histdups'?: boolean;
  /** Enable mouse clicking and vertical scrolling. */
  mouse?: boolean;
  /** Enable mouse clicking and vertical scrolling. */
  MOUSE?: boolean;
  /** Enable mouse features. @default '-' */
  emouse?: number | string;
  /** Reverse mouse scroll direction. */
  rmouse?: boolean;
  /** Each click of the mouse wheel moves N lines. @default 1 */
  'wheel-lines'?: number | string;
  /** Retain marks across invocations of less-pager-mini. */
  'save-marks'?: boolean;
  /** Set the width of the -N line number field to N characters. @default 7 */
  'line-num-width'?: number | string;
  /** Set the width of the -J status column to N characters. @default 2 */
  'status-col-width'?: number | string;
  /** Search file as each pattern character is typed in. */
  incsearch?: boolean;
  /** Enables colored text. */
  'use-color'?: boolean;
  /** Search with JavaScript regular expressions. */
  'use-js-regexp'?: boolean;
  /** Search with GNU regular expressions. */
  'use-gnu-regexp'?: boolean;
  /** Expand filenames with built-in zsh globbing. */
  'use-zsh-glob'?: boolean;
  /** Automatically determine the size of the input file. */
  'file-size'?: boolean;
  /** Highlight or color the entire line containing a mark. */
  'status-line'?: boolean;
  /** Use L lines (starting at line N) and C columns as headers. @default '-' */
  header?: number | string;
  /** Ignore pasted input. */
  'no-paste'?: boolean;
  /** Stop scrolling when a form feed character is reached. */
  'form-feed'?: boolean;
  /** Scrolling commands continue past end of file. */
  'past-eof'?: boolean;
  /** Don't warn when using v command on a file opened via LESSOPEN. */
  'no-edit-warn'?: boolean;
  /** Don't warn when editing a file opened via LESSOPEN. */
  'no-warn-edit'?: boolean;
  /** Don't give line numbers to header lines. */
  'no-number-headers'?: boolean;
  /** Searches do not include header lines or columns. */
  'no-search-headers'?: boolean;
  /** Searches do not include header lines. */
  'no-search-header-lines'?: boolean;
  /** Searches do not include header columns. */
  'no-search-header-columns'?: boolean;
  /** Redraw final screen when quitting. */
  'redraw-on-quit'?: boolean;
  /** Set default options for every search. @default '-' */
  'search-options'?: number | string;
  /** Exit F command on a pipe when writer closes pipe. */
  'exit-follow-on-close'?: boolean;
  /** Disable the terminal's visual bell. */
  'no-vbell'?: boolean;
  /** Read N lines from the input file and look for vim modelines. @default 0 */
  modelines?: number | string;
  /** Use C instead of ^X to interrupt a read. @default '' */
  intr?: number | string;
  /** Wrap lines at spaces. */
  wordwrap?: boolean;
  /** Display a message if preprocessor exits with an error status. */
  'show-preproc-errors'?: boolean;
  /** Process backspaces for bold/underline. */
  'proc-backspace'?: boolean;
  /** Treat backspaces as control characters. */
  'PROC-BACKSPACE'?: boolean;
  /** Expand tabs to spaces. */
  'proc-tab'?: boolean;
  /** Treat tabs as control characters. */
  'PROC-TAB'?: boolean;
  /** Delete carriage returns before newline. */
  'proc-return'?: boolean;
  /** Treat carriage returns as control characters. */
  'PROC-RETURN'?: boolean;
  /** A less option. */
  cmd?: number | string;
  /** Show at least N characters to the left of a search match. @default '0' */
  'match-shift'?: number | string;
  /** Actions which cause the history file to be saved. @default '-' */
  autosave?: number | string;
  /** String to be printed after erasing the prompt. @default '-' */
  'end-prompt'?: number | string;
}

/**
 * Every option LETTER the scan accepts, so `-R` and `-N` are offered
 * beside the long names. A letter carries no doc comment: less's help
 * describes the option, and the letter is one spelling of it.
 */
export type LessOptionLetter =
  | '"'
  | '#'
  | '?'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | '~';
