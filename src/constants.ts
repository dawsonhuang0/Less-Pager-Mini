export const ALTERNATE_CONSOLE_ON = '\x1b[?1049h';
export const ALTERNATE_CONSOLE_OFF = '\x1b[?1049l';

export const INVERSE_ON = '\x1b[7m';
export const INVERSE_OFF = '\x1b[0m';

export const BOLD_ON = '\x1b[1m';
export const BOLD_OFF = '\x1b[0m';

export const UNDERLINE_ON = '\x1B[4m';
export const UNDERLINE_OFF = '\x1B[24m';

export const END_MARKER = INVERSE_ON + '(END)' + INVERSE_OFF;
