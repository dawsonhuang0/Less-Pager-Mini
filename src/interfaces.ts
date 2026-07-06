/**
 * Global configuration options for the pager display and behavior.
 */
export interface Config {
  windowContent: string[];
  startLine: number;

  row: number;
  subRow: number;

  // Blank rows displayed above the beginning of the content, like less
  // padding the top when a jump target lands near BOF (jump_loc/forw)
  blankTop: number;

  // Last row & subRow without exceeding EOF
  endRow: number;
  endSubRow: number;

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

  // Pending multi-key command prefix (^X, ESC), echoed at the prompt like
  // less's A_PREFIX state
  keyPrefix: string;
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
  | 'ADD_BUFFER'
  | 'DEL_BUFFER'
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
  | 'SET_MARK'
  | 'SET_MARK_BOTTOM'
  | 'GO_MARK'
  | 'CLEAR_MARK'
  | 'OPEN_FILE'
  | 'NEXT_FILE'
  | 'PREV_FILE'
  | 'INDEX_FILE'
  | 'REMOVE_FILE'
  | 'CURRENT_INFO'
  | 'VERSION';
