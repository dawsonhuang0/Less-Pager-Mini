import { maxSubRow, ringBell } from "../helpers";

import { config, mode } from "../pagerConfig";

export function lineForward(content: string[]): void {
  if (mode.EOF) {
    ringBell();
    return;
  }

  if (config.subRow < maxSubRow(content[config.row])) {
    config.subRow++;
  } else {
    config.row++;
    config.subRow = 0;
  }
}

export function lineBackward(content: string[]): void {
  if (!config.row && !config.subRow) {
    ringBell();
    return;
  }

  if (!config.chopLongLines && config.subRow > 0) {
    config.subRow--;
  } else {
    config.row--;
    config.subRow = maxSubRow(content[config.row]);
  }
}
