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
    default:
      return undefined;
  }
}