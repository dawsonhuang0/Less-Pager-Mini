export const action = (key: string): string | undefined => keys[key];

export enum Actions {
  // jumping
  CLOSE_BRACKET = 'CLOSE_BRACKET',
  OPEN_BRACKET = 'OPEN_BRACKET',

  // repainting
  REPAINT = 'REPAINT',
  DROP_INPUT_REPAINT = 'DROP_INPUT_REPAINT',

  // searching
  SEARCH_LINE_BACKWARD = 'SEARCH_LINE_BACKWARD',
  SEARCH_LINE_FORWARD = 'SEARCH_LINE_FORWARD',
  REPEAT_SEARCH = 'REPEAT_SEARCH',
  REVERSE_SEARCH = 'REVERSE_SEARCH',
  HIGHLIGHT_TOGGLE = 'HIGHLIGHT_TOGGLE',
  CLEAR_SEARCH = 'CLEAR_SEARCH',
  PATTERN_ONLY = 'PATTERN_ONLY',
}

const keys: Record<string, string> = {
  // force exit
  '\x03': 'FORCE_EXIT', // ^C

  // exit
  '\x51': 'EXIT', // Q
  '\x71': 'EXIT', // q

  // help
  '\x48': 'HELP', // H
  '\x68': 'HELP', // h

  // version
  '\x56': 'VERSION', // V

  // get line

  // line backward
  '\x0B': 'LINE_BACKWARD', // ^K
  '\x10': 'LINE_BACKWARD', // ^P
  '\x19': 'LINE_BACKWARD', // ^Y
  '\x6B': 'LINE_BACKWARD', // k
  '\x79': 'LINE_BACKWARD', // y
  '\x1B[A': 'LINE_BACKWARD', // ARROW UP

  // line forward
  '\x05': 'LINE_FORWARD', // ^E
  '\x0E': 'LINE_FORWARD', // ^N
  '\x65': 'LINE_FORWARD', // e
  '\x6A': 'LINE_FORWARD', // j
  '\x0D': 'LINE_FORWARD', // RETURN
  '\x1B[B': 'LINE_FORWARD', // ARROW DOWN

  // window backward
  '\x02': 'WINDOW_BACKWARD', // ^B
  '\x62': 'WINDOW_BACKWARD', // b
  '\x77': 'WINDOW_BACKWARD', // w
  '\x1Bv': 'WINDOW_BACKWARD', // ESC-v

  // window forward
  '\x06': 'WINDOW_FORWARD', // ^F
  '\x16': 'WINDOW_FORWARD', // ^V
  '\x66': 'WINDOW_FORWARD', // f
  '\x7A': 'WINDOW_FORWARD', // z
  '\x20': 'WINDOW_FORWARD', // SPACE

  // half window backward
  '\x15': 'HALF_WINDOW_BACKWARD', // ^U
  '\x75': 'HALF_WINDOW_BACKWARD', // u

  // half window forward
  '\x04': 'HALF_WINDOW_FORWARD', // ^D
  '\x64': 'HALF_WINDOW_FORWARD', // d

  // half window left
  '\x1B(': 'HALF_WINDOW_LEFT', // ESC-(
  '\x1B[D': 'HALF_WINDOW_LEFT', // LEFT ARROW

  // half window right
  '\x1B)': 'HALF_WINDOW_RIGHT', // ESC-)
  '\x1B[C': 'HALF_WINDOW_RIGHT', // RIGHT ARROW

  // first column
  '\x1B{': 'FIRST_COL', // ESC-{
  '\x1B[1;5D': 'FIRST_COL', // ^LEFT ARROW

  // last column
  '\x1B}': 'LAST_COL', // ESC-}
  '\x1B[1;5C': 'LAST_COL', // ^RIGHT ARROW

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