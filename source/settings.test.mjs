import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SettingsStore, normalizeSettings } from './settings.mjs';
import { clientConfig } from './config.mjs';
test('connection settings keep certificate validation and encrypted dns while applying explicit choices', () => {
  const config = clientConfig(
    { server: 'home.example', uuid: randomUUID() },
    {
      mode: 'tun',
      endpointIPs: ['203.0.113.8', '2001:db8::8'],
      settings: {
        dnsProvider: 'quad9',
        tlsMin: '1.3',
        mtu: 1280,
        ipPreference: 'ipv6',
        stack: 'gvisor',
        connectTimeout: 30,
        udpEncoding: 'packetaddr',
      },
    },
  );
  assert.equal(config.outbounds[0].tls.min_version, '1.3');
  assert.equal(config.outbounds[0].tls.insecure, undefined);
  assert.equal(config.outbounds[0].server, '2001:db8::8');
  assert.equal(config.dns.servers[1].server, '9.9.9.9');
  assert.equal(config.dns.servers[1].detour, 'proxy');
  assert.equal(config.inbounds[1].mtu, 1280);
  assert.equal(config.inbounds[1].stack, 'gvisor');
  assert.throws(() => normalizeSettings({ allowInsecure: true }));
  assert.throws(() => normalizeSettings({ mtu: 65000 }));
});
test('settings persist atomically and concurrent changes preserve the latest selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nightwire-settings-'));
  try {
    const store = new SettingsStore(dir);
    await store.load();
    await Promise.all([
      store.update({ theme: 'moss' }),
      store.update({ theme: 'plum' }),
      store.update({ chartSeconds: 300 }),
      store.update({ encryptedHello: 'required' }),
    ]);
    const restored = new SettingsStore(dir);
    await restored.load();
    assert.equal(restored.value.theme, 'plum');
    assert.equal(restored.value.chartSeconds, 300);
    assert.equal(restored.value.encryptedHello, 'required');
    assert.equal(restored.saved, true);
    assert.equal(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).theme, 'plum');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('required encrypted clienthello preserves endpoint identity and bootstraps only its key', () => {
  const config = clientConfig(
    { server: 'home.example', serverName: 'gateway.example', uuid: randomUUID() },
    {
      endpointIPs: ['203.0.113.8'],
      ipv6: false,
      settings: { encryptedHello: 'required', tlsMin: '1.2', dnsProvider: 'google' },
    },
  );
  const proxy = config.outbounds[0];
  assert.equal(proxy.tls.min_version, '1.3');
  assert.equal(proxy.tls.server_name, 'gateway.example');
  assert.equal(proxy.tls.insecure, undefined);
  assert.deepEqual(proxy.tls.ech, { enabled: true });
  assert.equal(proxy.transport.headers.Host, 'gateway.example');
  assert.equal(config.dns.final, 'remote');
  assert.equal(config.dns.servers[1].detour, 'proxy');
  assert.equal(config.dns.servers[2].detour, undefined);
  assert.equal(config.dns.servers[2].tls.server_name, 'dns.google');
  assert.deepEqual(config.dns.rules[0], {
    domain: ['gateway.example'],
    query_type: ['HTTPS'],
    action: 'route',
    server: 'ech-bootstrap',
  });
  assert.equal(config.dns.rules[1].action, 'predefined');
  assert.ok(config.dns.rules[1].query_type.includes('HTTPS'));
  const ordinary = clientConfig({ server: 'home.example', uuid: randomUUID() });
  assert.equal(ordinary.outbounds[0].tls.ech, undefined);
  assert.equal(ordinary.dns.servers.length, 2);
  assert.throws(() => normalizeSettings({ encryptedHello: 'automatic' }));
  assert.throws(() =>
    clientConfig(
      { server: '127.0.0.1', uuid: randomUUID(), tls: false },
      { settings: { encryptedHello: 'required' } },
    ),
  );
});
