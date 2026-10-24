import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeProfile } from './config.mjs';

export class ProfileStore {
  constructor(directory, crypto) {
    this.directory = directory;
    this.crypto = crypto;
    this.profiles = [];
  }
  async load() {
    try {
      const encrypted = await readFile(join(this.directory, 'profiles.bin'));
      const value = JSON.parse(this.crypto.decryptString(encrypted));
      if (!Array.isArray(value)) throw Error('invalid profile store');
      this.profiles = value.map((p) => ({ id: p.id, profile: normalizeProfile(p.profile) }));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.locked = true;
        throw Error(
          'saved invites could not be decrypted; check access to your operating system keychain',
        );
      }
    }
  }
  list() {
    return this.profiles.map(({ id, profile: p }) => ({
      id,
      name: p.name,
      server: p.server,
      port: p.port,
      transport: p.transport,
    }));
  }
  get(id) {
    const item = this.profiles.find((x) => x.id === id);
    if (!item) throw Error('choose a saved invite first');
    return item.profile;
  }
  async persist() {
    if (this.locked)
      throw Error('restore access to saved invites before changing this profile store');
    if (!this.crypto.isEncryptionAvailable())
      throw Error('secure credential storage is unavailable');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const p = join(this.directory, 'profiles.bin');
    await writeFile(p + '.tmp', this.crypto.encryptString(JSON.stringify(this.profiles)), {
      mode: 0o600,
    });
    await chmod(p + '.tmp', 0o600);
    await rename(p + '.tmp', p);
  }
  async add(profile) {
    const item = { id: randomUUID(), profile: normalizeProfile(profile) };
    this.profiles.push(item);
    try {
      await this.persist();
    } catch (e) {
      this.profiles.pop();
      throw e;
    }
    return item.id;
  }
  async remove(id) {
    const before = this.profiles;
    this.profiles = this.profiles.filter((x) => x.id !== id);
    try {
      await this.persist();
    } catch (e) {
      this.profiles = before;
      throw e;
    }
  }
}
