import fs from 'fs';
import os from 'os';
import path from 'path';

let config: Record<string, boolean | number> = {};

export function fetchConfig() {
  const configFilePath = path.join(getConfigDir(), 'pagerConfig.json');

  if (!fs.existsSync(configFilePath)) {
    resetConfig();
    storeConfig();
    return;
  }

  const localConfig = JSON.parse(
    fs.readFileSync(configFilePath, 'utf8')
  );

  config = localConfig;
}

export function storeConfig() {
  const configDir = getConfigDir();
  const configFilePath = path.join(configDir, 'pagerConfig.json');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configFilePath, JSON.stringify(config), 'utf8');
}

export function resetConfig() {
  const defaultConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'defaultConfig.json'), 'utf8')
  );

  config = defaultConfig;
}

function getConfigDir(): string {
  const home = os.homedir();

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || home, 'less-pager-mini');
  }

  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
    'less-pager-mini'
  );
}