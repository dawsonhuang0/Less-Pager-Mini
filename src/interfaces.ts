/**
 * Global configuration options for the pager display and behavior.
 */
export interface Config {
  row: number;
  subRow: number;

  col: number;
  setCol: number;

  setWindow: number;
  setHalfWindow: number;

  window: number;
  halfWindow: number;

  screenWidth: number;
  halfScreenWidth: number;

  chopLongLines: boolean;

  indentation: number;
  bufferOffset: number;
}

/**
 * Represents the current state of the pager.
 */
export type Mode =
  | 'INIT'
  | 'EOF'
  | 'BUFFERING'
  | 'HELP';

/**
 * Represents all possible key-based actions in the pager.
 * 
 * These actions control navigation, search, file operations, and various pager
 * behaviors. They are typically triggered by specific key presses.
 */
export type Actions =
  | 'BACKSPACE'
  | 'COMMAND'
  | 'Z_EXIT'
  | 'ESC'
  | 'TAG_COMMAND'
  | 'ADD_COMMAND'
  | 'SHELL_COMMAND'
  | 'QUIT'
  | 'HELP'
  | 'EXIT'
  | 'FORCE_EXIT'
  | 'LINE_FORWARD'
  | 'LINE_BACKWARD'
  | 'WINDOW_FORWARD'
  | 'WINDOW_BACKWARD'
  | 'SET_WINDOW_FORWARD'
  | 'SET_WINDOW_BACKWARD'
  | 'NO_EOF_WINDOW_FORWARD'
  | 'SET_HALF_WINDOW_FORWARD'
  | 'SET_HALF_WINDOW_BACKWARD'
  | 'SET_HALF_SCREEN_RIGHT'
  | 'SET_HALF_SCREEN_LEFT'
  | 'LAST_COL'
  | 'FIRST_COL'
  | 'REPAINT'
  | 'DROP_INPUT_REPAINT'
  | 'SEARCH_FORWARD'
  | 'SEARCH_BACKWARD'
  | 'REPEAT_SEARCH'
  | 'REVERSE_SEARCH'
  | 'HIGHLIGHT_TOGGLE'
  | 'CLEAR_SEARCH'
  | 'PATTERN_ONLY'
  | 'FIRST_LINE'
  | 'LAST_LINE'
  | 'PERCENT_LINE'
  | 'CURLY_BRACKET_RIGHT'
  | 'ROUND_BRACKET_RIGHT'
  | 'SQUARE_BRACKET_RIGHT'
  | 'CURLY_BRACKET_LEFT'
  | 'ROUND_BRACKET_LEFT'
  | 'SQUARE_BRACKET_LEFT'
  | 'CUSTOM_BRACKET_RIGHT'
  | 'CUSTOM_BRACKET_LEFT'
  | 'OPEN_FILE'
  | 'CURRENT_INFO'
  | 'VERSION';
