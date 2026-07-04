/* eslint-disable no-control-regex */

export const ASCII_REGEX = /^[\x00-\x7F]*$/;
export const STYLE_REGEX = /\x1b\[[0-9;]*m/;
export const STYLE_REGEX_G = /\x1b\[[0-9;]*m/g;

export const CONSOLE_TITLE_START = '\x1b]0;';
export const CONSOLE_TITLE_END = '\x07';
export const CONSOLE_TITLE_RESET = CONSOLE_TITLE_START + CONSOLE_TITLE_END;

export const CONSOLE_CLEAR = '\x1b[2J\x1b[H';

export const ALTERNATE_CONSOLE_ON = '\x1b[?1049h';
export const ALTERNATE_CONSOLE_OFF = '\x1b[?1049l';

export const ALTERNATE_SCROLL_ON = '\x1b[?1007h';
export const ALTERNATE_SCROLL_OFF = '\x1b[?1007l';

export const MOUSE_ON = '\x1b[?1000h';
export const MOUSE_OFF = '\x1b[?1000l';

export const MOUSE_SGR_ON = '\x1b[?1006h';
export const MOUSE_SGR_OFF = '\x1b[?1006l';

export const SCROLL_UP_REGEX = /^\x1b\[<64;.*?M/;
export const SCROLL_DOWN_REGEX = /^\x1b\[<65;.*?M/;

export const STYLE_RESET = '\x1b[0m';

export const INVERSE_ON = '\x1b[7m';
export const INVERSE_OFF = '\x1b[27m';

export const BOLD_ON = '\x1b[1m';
export const BOLD_OFF = '\x1b[22m';

export const UNDERLINE_ON = '\x1B[4m';
export const UNDERLINE_OFF = '\x1B[24m';

export const TILDE = BOLD_ON + '~' + BOLD_OFF;
export const END_MARKER = INVERSE_ON + '(END)' + INVERSE_OFF;
