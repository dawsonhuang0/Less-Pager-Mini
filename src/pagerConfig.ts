import { Config, Mode } from "./interfaces";

export const config: Config = {
  row: 0,
  col: 0,
  subRow: 0,
  setWindow: -1,
  setHalfWindow: -1,
  window: process.stdout.rows ?? 24,
  halfWindow: (process.stdout.rows ?? 24) / 2,
  screenWidth: process.stdout.columns ?? 80,
  halfScreenWidth: (process.stdout.columns ?? 80) / 2,
  chopLongLines: false,
  indentation: 2,
};

export const mode: Record<Mode, boolean> = {
  'INIT': true,
  'NORMAL': false,
  'EOF': false,
}
