import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = path.resolve(__dirname, '../../../settings.json');

type SettingsMap = Record<string, string | number | boolean | null>;

let cache: SettingsMap = {};
let loaded = false;

function load() {
  if (loaded) return;
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      cache = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch {
      cache = {};
    }
  }
  loaded = true;
}

function persist() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(cache, null, 2));
}

export const Settings = {
  get<T = string>(key: string, fallback?: T): T | undefined {
    load();
    const v = cache[key];
    return (v === undefined || v === null ? fallback : (v as unknown as T));
  },
  set(key: string, value: string | number | boolean | null) {
    load();
    cache[key] = value;
    persist();
  },
  remove(key: string) {
    load();
    delete cache[key];
    persist();
  },
  all(): SettingsMap {
    load();
    return { ...cache };
  },
  // Safe subset for sending to client (no secrets)
  publicSubset(): SettingsMap {
    load();
    const out: SettingsMap = {};
    for (const [k, v] of Object.entries(cache)) {
      if (/secret|key|password|token/i.test(k)) continue;
      out[k] = v;
    }
    return out;
  },
};
