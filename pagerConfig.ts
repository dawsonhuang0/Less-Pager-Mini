import { Config } from "./interfaces";

export const config: Config = {
  row: 0,
  col: 0,
  window: process.stdout.rows ?? 24,
  setWindow: -1,
  halfWindow: 0,
  setHalfWindow: -1,
  screenWidth: process.stdout.columns ?? 80,
  halfScreenWidth: 0,
  chopLongLines: false,
  indentation: 2,
};