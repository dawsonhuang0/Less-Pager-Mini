/**
 * ANSI color codes for testing styled text rendering
 */
export const RED = '\x1b[31m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const BLUE = '\x1b[34m';
export const MAGENTA = '\x1b[35m';
export const CYAN = '\x1b[36m';
export const WHITE = '\x1b[37m';

/**
 * ANSI background color codes
 */
export const BG_RED = '\x1b[41m';
export const BG_GREEN = '\x1b[42m';
export const BG_YELLOW = '\x1b[43m';
export const BG_BLUE = '\x1b[44m';
export const BG_MAGENTA = '\x1b[45m';
export const BG_CYAN = '\x1b[46m';
export const BG_WHITE = '\x1b[47m';

/**
 * ANSI style codes
 */
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const ITALIC = '\x1b[3m';
export const UNDERLINE = '\x1b[4m';
export const BLINK = '\x1b[5m';
export const INVERSE = '\x1b[7m';
export const HIDDEN = '\x1b[8m';
export const STRIKETHROUGH = '\x1b[9m';

/**
 * ANSI reset codes
 */
export const RESET = '\x1b[0m';
export const BOLD_OFF = '\x1b[22m';
export const UNDERLINE_OFF = '\x1b[24m';
export const INVERSE_OFF = '\x1b[27m';

/**
 * ANSI 256-color codes (examples)
 */
export const FG_256 = (n: number) => `\x1b[38;5;${n}m`;
export const BG_256 = (n: number) => `\x1b[48;5;${n}m`;

/**
 * ANSI RGB color codes
 */
export const FG_RGB = (r: number, g: number, b: number) =>
  `\x1b[38;2;${r};${g};${b}m`;
export const BG_RGB = (r: number, g: number, b: number) =>
  `\x1b[48;2;${r};${g};${b}m`;
