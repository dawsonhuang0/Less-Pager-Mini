import { Config, Mode } from "./interfaces";

// fallbacks when the terminal reports no size, like screen.c's
// DEF_SC_HEIGHT/DEF_SC_WIDTH
export const DEFAULT_WINDOW = 24;
export const DEFAULT_COLUMN = 80;

/**
 * Global configuration for pager rendering and navigation.
 */
export let config: Config = getDefaultConfig();

/**
 * Tracks the current pager state.
 */
export let mode: Record<Mode, boolean> = getDefaultMode();

// og's full_screen (screen.c:300). Lives here rather than in the
// screen module so both the size probe that clears it and the
// painters that read it can reach it without importing each other.
let wholeTerminal = true;

/**
 * True while the pager owns every line of the terminal.
 *
 * $LESS_LINES says otherwise: the rows below the window belong to
 * whoever launched us, so og stops scrolling into them. It repaints
 * where it would have scrolled (make_display, command.c:863; jump_loc,
 * jump.c:244) and drops the "...skipping..." marker (forwback.c:272).
 * og also refuses the "ll" capability then (screen.c:1685); we always
 * address the cursor absolutely, so that one needs nothing.
 */
export const fullScreen = (): boolean => wholeTerminal;

/** Records what scrsize found, like og assigning full_screen. */
export function setFullScreen(value: boolean): void {
  wholeTerminal = value;
}

/**
 * Overwrites all pager configuration with a new one.
 *
 * @param newConfig New configuration object.
 */
export function applyConfig(newConfig: Config): void {
  config = newConfig;
}

/**
 * Overwrites all mode flags with a new set.
 *
 * @param newMode New mode flags.
 */
export function applyMode(newMode: Record<Mode, boolean>): void {
  mode = newMode;
}

/**
 * Resets the global configuration to default values.
 */
export function resetConfig(): void {
  config = getDefaultConfig();
  // og starts every process owning the whole terminal; scrsize takes
  // it away again if this session's $LESS_LINES asks
  wholeTerminal = true;
}

/**
 * Resets all mode flags to their default state.
 */
export function resetMode(): void {
  mode = getDefaultMode();
}

function getDefaultConfig(): Config {
  // a zero size (some pseudo-terminals) falls back like og's scrsize
  const rows = process.stdout.rows || DEFAULT_WINDOW;
  const columns = process.stdout.columns || DEFAULT_COLUMN;

  return {
    windowContent: new Array(rows).fill(''),
    startLine: 0,
    row: 0,
    subRow: 0,
    subShift: 0,
    subAnchor: 0,
    screen: [],
    blankTop: 0,
    endRow: 0,
    endSubRow: 0,
    col: 0,
    setCol: 0,
    // og's swindow defaults to -1: the scroll window is the screen
    // height minus header lines plus this when it is not positive
    setWindow: -1,
    setHalfWindow: 0,
    window: rows,
    // og's wscroll = (sc_height + 1) / 2, rounded up (screen.c:998)
    halfWindow: Math.floor((rows + 1) / 2),
    screenWidth: columns,
    halfScreenWidth: Math.floor(columns / 2),
    chopLongLines: false,
    tabObjectIndent: '\t',
    bufferOffset: 0,
    keyPrefix: '',
    attnRow: -1,
  };
}

function getDefaultMode(): Record<Mode, boolean> {
  return {
    'INIT': true,
    'EOF': false,
    'BUFFERING': false,
    'HELP': false,

    // set at session start for terminals without cursor capabilities,
    // like og's missing_cap; survives help-screen mode swaps
    'DUMB': false,
  };
}
