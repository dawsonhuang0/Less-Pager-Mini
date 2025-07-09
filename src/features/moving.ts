import { config } from "../pagerConfig";

const getSubRows = (line: string): number =>
  config.chopLongLines? 0: Math.floor(line.length / config.screenWidth);

export function lineForward(content: string[]): void {
  if (config.subRow < getSubRows(content[config.row])) {
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
    config.subRow = getSubRows(content[config.row]);
  }
}
