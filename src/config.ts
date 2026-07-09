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
    blankTop: 0,
    endRow: 0,
    endSubRow: 0,
    col: 0,
    setCol: 0,
    setWindow: 0,
    setHalfWindow: 0,
    window: rows,
    halfWindow: Math.floor(rows / 2),
    screenWidth: columns,
    halfScreenWidth: Math.floor(columns / 2),
    chopLongLines: false,
    indentation: 2,
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
