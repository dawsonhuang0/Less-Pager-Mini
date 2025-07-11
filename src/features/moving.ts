import { maxSubRow, ringBell, offsetToNum } from "../helpers";

import { config, mode } from "../pagerConfig";

export function lineForward(content: string[], offset: string): void {
  if (mode.EOF) {
    ringBell();
    return;
  }

  const n = offsetToNum(offset);

  for (let i = 0; i < n; i++) {
    if (config.subRow < maxSubRow(content[config.row])) {
      config.subRow++;
    } else {
      config.row++;
      config.subRow = 0;
    }

    if (config.row >= content.length) {
      config.row = content.length - 1;

      if (!config.chopLongLines) {
        const maxSubRows = maxSubRow(content[config.row]);
        if (config.subRow > maxSubRows) config.subRow = maxSubRows;
      }

      return;
    }
  }
}

export function lineBackward(content: string[], offset: string): void {
  if (!config.row && !config.subRow) {
    ringBell();
    return;
  }

  const n = offsetToNum(offset);

  for (let i = 0; i < n; i++) {
    if (!config.chopLongLines && config.subRow > 0) {
      config.subRow--;
    } else {
      config.row--;
      config.subRow = maxSubRow(content[config.row]);
    }

    if (!config.row && !config.subRow) return;
  }
}
