export const action = (key: string): Actions | undefined => keys[key];

export enum Actions {
  // basic
  FORCE_EXIT = 'FORCE_EXIT',
  EXIT = 'EXIT',
  HELP = 'HELP',
  VERSION = 'VERSION',
  GET_LINE = 'GET_LINE',

  // moving
  LINE_BACKWARD = 'LINE_BACKWARD',
  LINE_FORWARD = 'LINE_FORWARD',
  WINDOW_BACKWARD = 'WINDOW_BACKWARD',
  WINDOW_FORWARD = 'WINDOW_FORWARD',
  HALF_WINDOW_BACKWARD = 'HALF_WINDOW_BACKWARD',
  HALF_WINDOW_FORWARD = 'HALF_WINDOW_FORWARD',
  HALF_WINDOW_LEFT = 'HALF_WINDOW_LEFT',
  HALF_WINDOW_RIGHT = 'HALF_WINDOW_RIGHT',
  FIRST_COL = 'FIRST_COL',
  LAST_COL = 'LAST_COL',

  // jumping
  FIRST_LINE = 'FIRST_LINE',
  LAST_LINE = 'LAST_LINE',
  PCT_LINE = 'PCT_LINE',
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

const keys: Record<string, Actions> = {
  // force exit
  '\x03': Actions.FORCE_EXIT, // ^C

  // exit
  '\x51': Actions.EXIT, // Q
  '\x71': Actions.EXIT, // q

  // help
  '\x48': Actions.HELP, // H
  '\x68': Actions.HELP, // h

  // version
  '\x56': Actions.VERSION, // V

  // line backward
  '\x0B': Actions.LINE_BACKWARD, // ^K
  '\x10': Actions.LINE_BACKWARD, // ^P
  '\x19': Actions.LINE_BACKWARD, // ^Y
  '\x6B': Actions.LINE_BACKWARD, // k
  '\x79': Actions.LINE_BACKWARD, // y
  '\x1B[A': Actions.LINE_BACKWARD, // ARROW UP

  // line forward
  '\x05': Actions.LINE_FORWARD, // ^E
  '\x0E': Actions.LINE_FORWARD, // ^N
  '\x65': Actions.LINE_FORWARD, // e
  '\x6A': Actions.LINE_FORWARD, // j
  '\x0D': Actions.LINE_FORWARD, // RETURN
  '\x1B[B': Actions.LINE_FORWARD, // ARROW DOWN

  // window backward
  '\x02': Actions.WINDOW_BACKWARD, // ^B
  '\x62': Actions.WINDOW_BACKWARD, // b
  '\x77': Actions.WINDOW_BACKWARD, // w
  '\x1Bv': Actions.WINDOW_BACKWARD, // ESC-v

  // window forward
  '\x06': Actions.WINDOW_FORWARD, // ^F
  '\x16': Actions.WINDOW_FORWARD, // ^V
  '\x66': Actions.WINDOW_FORWARD, // f
  '\x7A': Actions.WINDOW_FORWARD, // z
  '\x20': Actions.WINDOW_FORWARD, // SPACE

  // half window backward
  '\x15': Actions.HALF_WINDOW_BACKWARD, // ^U
  '\x75': Actions.HALF_WINDOW_BACKWARD, // u

  // half window forward
  '\x04': Actions.HALF_WINDOW_FORWARD, // ^D
  '\x64': Actions.HALF_WINDOW_FORWARD, // d

  // half window left
  '\x1B(': Actions.HALF_WINDOW_LEFT, // ESC-(
  '\x1B[D': Actions.HALF_WINDOW_LEFT, // LEFT ARROW

  // half window right
  '\x1B)': Actions.HALF_WINDOW_RIGHT, // ESC-)
  '\x1B[C': Actions.HALF_WINDOW_RIGHT, // RIGHT ARROW

  // first column
  '\x1B{': Actions.FIRST_COL, // ESC-{
  '\x1B[1;5D': Actions.FIRST_COL, // ^LEFT ARROW

  // last column
  '\x1B}': Actions.LAST_COL, // ESC-}
  '\x1B[1;5C': Actions.LAST_COL, // ^RIGHT ARROW

  // first line
  '\x67': Actions.FIRST_LINE, // g
  '\x3C': Actions.FIRST_LINE, // <
  '\x1B<': Actions.FIRST_LINE, // ESC-<

  // last line
  '\x47': Actions.LAST_LINE, // G
  '\x3E': Actions.LAST_LINE, // >
  '\x1B>': Actions.LAST_LINE, // ESC->

  // percent line
  '\x25': Actions.PCT_LINE, // %
  '\x70': Actions.PCT_LINE, // p
};