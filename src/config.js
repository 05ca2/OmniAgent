// 配置读写：配置存放在当前工作区的 .omni/config.json
import fs from 'node:fs';
import path from 'node:path';

export const OMNI_DIR = path.join(process.cwd(), '.omni');
export const CONFIG_PATH = path.join(OMNI_DIR, 'config.json');
export const PLUGIN_DIR = path.join(OMNI_DIR, 'plugins');
export const RUNS_DIR = path.join(OMNI_DIR, 'runs');

export function ensureDirs() {
  fs.mkdirSync(OMNI_DIR, { recursive: true });
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

export function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return CONFIG_PATH;
}

export function configExists() {
  return fs.existsSync(CONFIG_PATH);
}
