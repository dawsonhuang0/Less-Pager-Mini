import { Config, Mode } from "./interfaces";

/**
 * Global configuration for pager rendering and navigation.
 */
export let config: Config = {
  row: 0,
  col: 0,
  subRow: 0,
  setWindow: 0,
  setHalfWindow: 0,
  window: process.stdout.rows ?? 24,
  halfWindow: (process.stdout.rows ?? 24) / 2,
  screenWidth: process.stdout.columns ?? 80,
  halfScreenWidth: (process.stdout.columns ?? 80) / 2,
  chopLongLines: false,
  indentation: 2,
  bufferOffset: 0,
};

/**
 * Tracks the current pager state.
 */
export let mode: Record<Mode, boolean> = {
  'INIT': true,
  'EOF': false,
  'BUFFERING': false,
  'HELP': false,
}

export const applyConfig = (newConfig: Config) => config = newConfig;

export const applyMode = (newMode: Record<Mode, boolean>) => mode = newMode;

export const resetConfig = () => config = {
  row: 0,
  col: 0,
  subRow: 0,
  setWindow: 0,
  setHalfWindow: 0,
  window: process.stdout.rows ?? 24,
  halfWindow: (process.stdout.rows ?? 24) / 2,
  screenWidth: process.stdout.columns ?? 80,
  halfScreenWidth: (process.stdout.columns ?? 80) / 2,
  chopLongLines: false,
  indentation: 2,
  bufferOffset: 0,
};

export const resetMode = () => mode = {
  'INIT': true,
  'EOF': false,
  'BUFFERING': false,
  'HELP': false,
};
