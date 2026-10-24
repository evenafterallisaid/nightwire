import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'midnight',
  rateUnit: 'bytes',
  chartSeconds: 60,
  dnsProvider: 'cloudflare',
  tlsMin: '1.2',
  mtu: 1400,
  ipPreference: 'ipv4',
  stack: 'mixed',
  connectTimeout: 20,
  udpEncoding: 'xudp',
  destinationFamily: 'auto',
});
export const CONNECTION_SETTINGS = [
  'dnsProvider',
  'tlsMin',
  'mtu',
  'ipPreference',
  'stack',
  'connectTimeout',
  'udpEncoding',
  'destinationFamily',
];
const choices = {
  theme: ['midnight', 'paper', 'ember', 'abyss', 'moss', 'plum', 'ocean', 'rose', 'system'],
  rateUnit: ['bytes', 'bits'],
  chartSeconds: [30, 60, 300],
  dnsProvider: ['cloudflare', 'quad9', 'google'],
  tlsMin: ['1.2', '1.3'],
  mtu: [1280, 1400, 1500],
  ipPreference: ['ipv4', 'ipv6', 'auto'],
  stack: ['mixed', 'gvisor', 'system'],
  connectTimeout: [10, 20, 30],
  udpEncoding: ['xudp', 'packetaddr'],
  destinationFamily: ['auto', 'ipv4', 'dual'],
};
export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid settings');
  for (const [key, choice] of Object.entries(value))
    if (!choices[key]?.includes(choice)) throw Error('invalid setting: ' + key);
  return { ...DEFAULT_SETTINGS, ...value };
}
export class SettingsStore {
  constructor(directory) {
    this.directory = directory;
    this.value = { ...DEFAULT_SETTINGS };
    this.saved = false;
  }
  async load() {
    try {
      this.value = normalizeSettings(
        JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8')),
      );
      this.saved = true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw Error('settings could not be loaded; defaults are in use');
    }
  }
  update(patch) {
    const operation = async () => {
      const next = normalizeSettings({ ...this.value, ...patch });
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = join(this.directory, 'settings.json');
      await writeFile(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(file + '.tmp', file);
      this.value = next;
      this.saved = true;
      return next;
    };
    this.pending = (this.pending || Promise.resolve()).catch(() => {}).then(operation);
    return this.pending;
  }
}
