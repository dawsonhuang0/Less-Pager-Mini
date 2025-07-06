import { Config } from "./interfaces";

export const config: Config = {
  row: 0,
  col: 0,
  window: process.stdout.rows ?? 24,
  halfWindow: 0,
  screenWidth: process.stdout.columns ?? 80,
  halfScreenWidth: 0,
  chopLongLines: true,
  indentation: 2,
};