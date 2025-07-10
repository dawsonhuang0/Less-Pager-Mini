import { maxSubRow } from "../helpers";

import { config } from "../pagerConfig";

export function lineForward(content: string[]): void {
  if (config.subRow < maxSubRow(content[config.row])) {
    config.subRow++;
  } else {
    config.row++;
    config.subRow = 0;
  }
}

export function lineBackward(content: string[]): void {
  if (!config.chopLongLines && config.subRow > 0) {
    config.subRow--;
  } else {
    config.row--;
    config.subRow = maxSubRow(content[config.row]);
  }
}
