import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  normalizeProfile,
  parseProfile,
  shareLink,
  clientConfig,
  serverConfig,
  PRIVATE_NETS,
} from './config.mjs';
const p = {
  name: 'Clyde / Home',
  server: 'home.example',
  uuid: randomUUID(),
  transport: 'ws',
  path: '/netmod-link-test',
};
test('share links preserve login and transport', () =>
  assert.deepEqual(parseProfile(shareLink(p)), normalizeProfile(p)));
test('IPv6 share links round trip', () => {
  const v = { ...p, server: '2001:db8::1' };
  assert.deepEqual(parseProfile(shareLink(v)), normalizeProfile(v));
});
test('public profiles require TLS and verified certificates', () => {
  assert.throws(() => normalizeProfile({ ...p, tls: false }));
  const u = new URL(shareLink(p));
  u.searchParams.set('allowInsecure', '1');
  assert.throws(() => parseProfile(u.toString()));
  assert.throws(() => parseProfile(`vless://${p.uuid}@test.example:443?allowInsecure=1`));
});
test('full-device config captures both address families and dns without bypassing shared edge ips', () => {
  const c = clientConfig(p, {
    mode: 'tun',
    platform: 'darwin',
    endpointIPs: ['104.21.61.130', '2606:4700::1'],
  });
  const t = c.inbounds[1];
  assert.equal(t.auto_route, true);
  assert.equal(t.dns_mode, 'hijack');
  assert.equal(t.address.length, 2);
  assert.equal(t.route_exclude_address, undefined);
  assert.equal(c.outbounds[0].server, '104.21.61.130');
  assert.equal(c.route.auto_detect_interface, true);
  assert.equal(c.dns.servers[1].detour, 'proxy');
  assert.equal(c.outbounds[0].packet_encoding, 'xudp');
});
test('full-device config refuses unresolved server and invalid mode', () => {
  assert.throws(() => clientConfig(p, { mode: 'tun' }));
  assert.throws(() => clientConfig(p, { mode: 'broken' }));
});
test('server is local-only and resolves domains before blocking private destinations', () => {
  const c = serverConfig([{ name: 'clyde', uuid: p.uuid }]);
  assert.equal(c.inbounds[0].listen, '127.0.0.1');
  assert.equal(c.route.rules[0].action, 'resolve');
  assert.deepEqual(c.route.rules[1].ip_cidr, PRIVATE_NETS);
  assert.equal(c.route.rules[1].action, 'reject');
});
test('revoked users removed, duplicates and empty active set rejected', () => {
  const c = serverConfig([
    { name: 'clyde', uuid: p.uuid },
    { name: 'friend', uuid: randomUUID(), enabled: false },
  ]);
  assert.equal(c.inbounds[0].users.length, 1);
  assert.throws(() => serverConfig([{ name: 'friend', uuid: p.uuid, enabled: false }]));
  assert.throws(() =>
    serverConfig([
      { name: 'a', uuid: p.uuid },
      { name: 'b', uuid: p.uuid },
    ]),
  );
});
