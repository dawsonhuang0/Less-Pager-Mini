import { Config, Mode } from "./interfaces";

const defaultConfig: Config = {
  row: 0,
  subRow: 0,
  col: 0,
  setCol: 0,
  setWindow: 0,
  setHalfWindow: 0,
  window: process.stdout.rows ?? 24,
  halfWindow: Math.floor((process.stdout.rows ?? 24) / 2),
  screenWidth: process.stdout.columns ?? 80,
  halfScreenWidth: Math.floor((process.stdout.columns ?? 80) / 2),
  chopLongLines: false,
  indentation: 2,
  bufferOffset: 0,
};

const defaultMode: Record<Mode, boolean> = {
  'INIT': true,
  'EOF': false,
  'BUFFERING': false,
  'HELP': false,
};

/**
 * Global configuration for pager rendering and navigation.
 */
export let config: Config = { ...defaultConfig };

/**
 * Tracks the current pager state.
 */
export let mode: Record<Mode, boolean> = { ...defaultMode };

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
  config = { ...defaultConfig };
}

/**
 * Resets all mode flags to their default state.
 */
export function resetMode(): void {
  mode = { ...defaultMode };
}
