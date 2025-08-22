/* eslint-disable no-control-regex */

export const ASCII_REGEX = /^[\x00-\x7F]*$/;
export const STYLE_REGEX = /\x1b\[[0-9;]*m/;
export const STYLE_REGEX_G = /\x1b\[[0-9;]*m/g;

export const CONSOLE_TITLE_START = '\x1b]0;';
export const CONSOLE_TITLE_END = '\x07';
export const CONSOLE_TITLE_RESET = CONSOLE_TITLE_START + CONSOLE_TITLE_END;

export const ALTERNATE_CONSOLE_ON = '\x1b[?1049h';
export const ALTERNATE_CONSOLE_OFF = '\x1b[?1049l';

export const INVERSE_ON = '\x1b[7m';
export const INVERSE_OFF = '\x1b[0m';

export const BOLD_ON = '\x1b[1m';
export const BOLD_OFF = '\x1b[0m';

export const UNDERLINE_ON = '\x1B[4m';
export const UNDERLINE_OFF = '\x1B[24m';

export const END_MARKER = INVERSE_ON + '(END)' + INVERSE_OFF;
