import { config } from "../pagerConfig";

export function lineForward(subRows: number): void {
  if (config.subRow < subRows) {
    config.subRow++;
  } else {
    config.row++;
    config.index++;
    config.subRow = 0;
  }
}

export function lineBackward(subRow: number): void {
  if (config.subRow > 0) {
    config.subRow--;
  } else {
    config.row--;
    config.index--;
    config.subRow = subRow;
  }
}