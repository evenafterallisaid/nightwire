import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ProfileStore } from './profiles.mjs';
test('profiles survive encrypted storage without exposing logins to the renderer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nightwire-profiles-'));
  const key = randomBytes(32);
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]);
    },
    decryptString: (b) => {
      const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(-16));
      return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
    },
  };
  try {
    const a = new ProfileStore(dir, crypto);
    await a.load();
    const uuid = randomUUID(),
      id = await a.add({ server: 'home.example', uuid });
    assert.equal(JSON.stringify(a.list()).includes(uuid), false);
    assert.equal((await readFile(join(dir, 'profiles.bin'))).includes(Buffer.from(uuid)), false);
    const b = new ProfileStore(dir, crypto);
    await b.load();
    assert.equal(b.get(id).uuid, uuid);
    await b.remove(id);
    assert.equal(b.list().length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
