import { Config } from "./interfaces";

export const config: Config = {
  window: process.stdout.rows ?? 24,
  halfWindow: 0,
  screenWidth: process.stdout.columns ?? 80,
  halfScreenWidth: 0,
  indentation: 2,
};