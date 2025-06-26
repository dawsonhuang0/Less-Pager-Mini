export const action = (key: string): string | undefined => keys[key];

export enum Actions {
  // jumping
  CLOSE_BRACKET = 'CLOSE_BRACKET',
  OPEN_BRACKET = 'OPEN_BRACKET',
}

const keys: Record<string, string> = {
  /**
   * (N) - any number
   * (*) - supports (N) as prefix
   * EOF - end-of-file
   */

  // command
  '\x3A': 'COMMAND', // :

  // Z-exit
  '\x5A': 'Z_EXIT', // Z

  // ESC command
  '\x1B': 'ESC', // ESC

  // help
  '\x68': 'HELP', // h
  '\x48': 'HELP', // H

  // exit
  '\x71': 'EXIT', // q
  '\x51': 'EXIT', // Q

  // hythen & underline command
  '\x2D': 'TAG_COMMAND', // -
  '\x5F': 'TAG_COMMAND', // _

  // (*) forward one line (or (N) lines)
  '\x65': 'LINE_FORWARD', // e
  '\x05': 'LINE_FORWARD', // ^E
  '\x6A': 'LINE_FORWARD', // j
  '\x0E': 'LINE_FORWARD', // ^N
  '\x0D': 'LINE_FORWARD', // CR
  '\x1B[B': 'LINE_FORWARD', // ARROW DOWN

  // (*) backward one line (or (N) lines)
  '\x79': 'LINE_BACKWARD', // y
  '\x19': 'LINE_BACKWARD', // ^Y
  '\x6B': 'LINE_BACKWARD', // k
  '\x0B': 'LINE_BACKWARD', // ^K
  '\x10': 'LINE_BACKWARD', // ^P
  '\x1B[A': 'LINE_BACKWARD', // ARROW UP

  // (*) forward one window (or (N) lines)
  '\x66': 'WINDOW_FORWARD', // f
  '\x06': 'WINDOW_FORWARD', // ^F
  '\x16': 'WINDOW_FORWARD', // ^V
  '\x20': 'WINDOW_FORWARD', // SPACE

  // (*) backward one window (or (N) lines)
  '\x62': 'WINDOW_BACKWARD', // b
  '\x02': 'WINDOW_BACKWARD', // ^B
  '\x1Bv': 'WINDOW_BACKWARD', // ESC-v

  // (*) forward one window (and set window to (N))
  '\x7A': 'SET_WINDOW_FORWARD', // z

  // (*) backward one window (and set window to (N))
  '\x77': 'SET_WINDOW_BACKWARD', // w

  // (*) forward one window but don't stop at EOF
  '\x1B\x20': 'NO_EOF_WINDOW_FORWARD', // ESC-SPACE

  // (*) forward one half-window (and set half-window to (N))
  '\x64': 'SET_HALF_WINDOW_FORWARD', // d
  '\x04': 'SET_HALF_WINDOW_FORWARD', // ^D

  // (*) backward one half-window (and set half-window to (N))
  '\x75': 'SET_HALF_WINDOW_BACKWARD', // u
  '\x15': 'SET_HALF_WINDOW_BACKWARD', // ^U

  // (*) right one half screen width (or (N) positions)
  '\x1B)': 'SET_HALF_SCREEN_RIGHT', // ESC-)
  '\x1B[C': 'SET_HALF_SCREEN_RIGHT', // RIGHT ARROW

  // (*) left one half screen width (or (N) positions)
  '\x1B(': 'SET_HALF_SCREEN_LEFT', // ESC-(
  '\x1B[D': 'SET_HALF_SCREEN_LEFT', // LEFT ARROW

  // right to last column displayed
  '\x1B}': 'LAST_COL', // ESC-}
  '\x1B[1;5C': 'LAST_COL', // ^RIGHT ARROW
  
  // left to first column
  '\x1B{': 'FIRST_COL', // ESC-{
  '\x1B[1;5D': 'FIRST_COL', // ^LEFT ARROW

  // repaint screen
  '\x72': 'REPAINT', // r
  '\x12': 'REPAINT', // ^R
  '\x0C': 'REPAINT', // ^L

  // repaint screen, discarding buffered input
  '\x52': 'DROP_INPUT_REPAINT', // R

  // (*) search forward for (N)-th matching line
  '\x2F': 'SEARCH_FORWARD', // /

  // (*) search backward for (N)-th matching line
  '\x3F': 'SEARCH_BACKWARD', // ?

  // (*) repeat previous search (for (N)-th occurrence)
  '\x6E': 'REPEAT_SEARCH', // n
  '\x1Bn': 'REPEAT_SEARCH', // ESC-n

  // (*) repeat previous search in reverse direction
  '\x4E': 'REVERSE_SEARCH', // N
  '\x1BN': 'REVERSE_SEARCH', // ESC-N

  // undo (toggle) search highlighting
  '\x1Bu': 'HIGHLIGHT_TOGGLE', // ESC-u

  // clear search highlighting
  '\x1BU': 'CLEAR_SEARCH', // ESC-U

  // (*) display only matching lines
  '\x26': 'PATTERN_ONLY', // &

  // version
  '\x56': 'VERSION', // V

  // get line

  // first line
  '\x67': 'FIRST_LINE', // g
  '\x3C': 'FIRST_LINE', // <
  '\x1B<': 'FIRST_LINE', // ESC-<

  // last line
  '\x47': 'LAST_LINE', // G
  '\x3E': 'LAST_LINE', // >
  '\x1B>': 'LAST_LINE', // ESC->

  // percent line
  '\x25': 'PCT_LINE', // %
  '\x70': 'PCT_LINE', // p
};