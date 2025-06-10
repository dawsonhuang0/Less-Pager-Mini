const UP = '\u001b[A', DOWN = '\u001b[B', SPACE = '\x20',
  CTRL_E = '\x05', CTRL_N = '\x0E', CTRL_Y = '\x19',
  CTRL_K = '\x0B', CTRL_P = '\x10', CTRL_F = '\x06',
  CTRL_V = '\x16', CTRL_B = '\x02', CTRL_D = '\x04',
  CTRL_U = '\x15', ESC_V = '\x1Bv';

export enum Actions {
  // basic
  EXIT = 'EXIT',
  HELP = 'HELP',
  VERSION = 'VERSION',

  // moving
  LINE_BACKWARD = 'LINE_BACKWARD',
  LINE_FORWARD = 'LINE_FORWARD',
  WINDOW_BACKWARD = 'WINDOW_BACKWARD',
  WINDOW_FORWARD = 'WINDOW_FORWARD',
  HALF_WINDOW_BACKWARD = 'HALF_WINDOW_BACKWARD',
  HALF_WINDOW_FORWARD = 'HALF_WINDOW_FORWARD',
  LEFT_HALF_WINDOW = 'LEFT_HALF_WINDOW',
  RIGHT_HALF_WINDOW = 'RIGHT_HALF_WINDOW',

  // jumping
  FIRST_LINE = 'FIRST_LINE',
  LAST_LINE = 'LAST_LINE',
  FIRST_COL = 'FIRST_COL',
  LAST_COL = 'LAST_COL'
}

export function action(key: string): Actions | undefined {
  switch (key) {
    case CTRL_Y:
    case CTRL_K:
    case CTRL_P:
    case UP:
      return Actions.LINE_BACKWARD;

    case CTRL_E:
    case CTRL_N:
    case DOWN:
      return Actions.LINE_FORWARD;

    case CTRL_B:
    case ESC_V:
      return Actions.WINDOW_BACKWARD;

    case CTRL_F:
    case CTRL_V:
    case SPACE:
      return Actions.WINDOW_FORWARD;
  }

  switch (key.toLowerCase()) {
    case 'q':
      return Actions.EXIT;
    
    case 'h':
      return Actions.HELP;

    case 'v':
      return Actions.VERSION;

    case 'y':
    case 'k':
      return Actions.LINE_BACKWARD;

    case 'e':
    case 'j':
      return Actions.LINE_FORWARD;

    case 'b':
    case 'w':
      return Actions.WINDOW_BACKWARD;

    case 'f':
    case 'z':
      return Actions.WINDOW_FORWARD;
  }

  return undefined;
}