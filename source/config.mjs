import { isIP } from 'node:net';
import { normalizeSettings } from './settings.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PRIVATE_NETS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::ffff:0:0/96',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];
function hostname(value) {
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    !value ||
    (/[\s/\\@?#:]/.test(value) && !isIP(value))
  )
    throw Error('enter a valid server hostname or ip address.');
  if (
    !isIP(value) &&
    !value.split('.').every((x) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(x) && x.length <= 63)
  )
    throw Error('invalid server hostname.');
  return value;
}
export function normalizeProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid profile.');
  const p = {
    version: 1,
    name: String(value.name || 'home connection').slice(0, 100),
    server: hostname(value.server),
    port: Number(value.port ?? 443),
    uuid: value.uuid,
    transport: value.transport ?? 'ws',
    tls: value.tls !== false,
    serverName: hostname(value.serverName || value.server),
    path: value.path ?? '/nightwire',
  };
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535)
    throw Error('invalid server port.');
  if (typeof p.uuid !== 'string' || !UUID.test(p.uuid)) throw Error('invalid vless login id.');
  if (!['ws', 'tcp'].includes(p.transport))
    throw Error('only websocket and tcp profiles are supported.');
  if (
    typeof p.path !== 'string' ||
    !p.path.startsWith('/') ||
    p.path.length > 512 ||
    /[\r\n\0]/.test(p.path)
  )
    throw Error('invalid websocket path.');
  if (!p.tls && !['127.0.0.1', '::1', 'localhost'].includes(p.server))
    throw Error('unencrypted connections are only allowed for local tests.');
  return p;
}
export function parseProfile(text) {
  if (typeof text !== 'string' || text.length > 65536)
    throw Error('profile must be smaller than 64 kb.');
  text = text.trim();
  if (text.startsWith('{')) return normalizeProfile(JSON.parse(text));
  const u = new URL(text);
  if (u.protocol !== 'vless:') throw Error('import a vless link or nightwire json profile.');
  if (u.searchParams.get('security') === 'reality' || u.searchParams.get('flow'))
    throw Error('this release supports tls websocket or tcp profiles, without reality/vision.');
  if (u.searchParams.get('allowInsecure') === '1' || u.searchParams.get('insecure') === '1')
    throw Error('profiles that disable certificate verification are not accepted.');
  const encryption = u.searchParams.get('encryption');
  if (encryption && encryption !== 'none') throw Error('unsupported vless encryption mode.');
  return normalizeProfile({
    name: decodeURIComponent(u.hash.slice(1)) || u.hostname,
    server: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port || 443,
    uuid: decodeURIComponent(u.username),
    transport: u.searchParams.get('type') || 'tcp',
    tls: u.searchParams.get('security') !== 'none',
    serverName: u.searchParams.get('sni') || u.hostname.replace(/^\[|\]$/g, ''),
    path: u.searchParams.get('path') || '/nightwire',
  });
}
export function shareLink(value) {
  const p = normalizeProfile(value);
  const host = isIP(p.server) === 6 ? `[${p.server}]` : p.server;
  const u = new URL(`vless://${p.uuid}@${host}:${p.port}`);
  for (const [k, v] of Object.entries({
    encryption: 'none',
    security: p.tls ? 'tls' : 'none',
    type: p.transport,
    sni: p.serverName,
    ...(p.transport === 'ws' ? { path: p.path, host: p.serverName } : {}),
  }))
    u.searchParams.set(k, v);
  u.hash = p.name;
  return u.toString();
}
function resolver(tag, detour, provider = 'cloudflare') {
  const [address, serverName] = {
    cloudflare: ['1.1.1.1', 'cloudflare-dns.com'],
    quad9: ['9.9.9.9', 'dns.quad9.net'],
    google: ['8.8.8.8', 'dns.google'],
  }[provider];
  return {
    type: 'https',
    tag,
    server: address,
    path: '/dns-query',
    tls: { enabled: true, server_name: serverName },
    ...(detour ? { detour } : {}),
  };
}
export function clientConfig(
  value,
  {
    mode = 'proxy',
    port = 10808,
    platform = process.platform,
    endpointIPs = [],
    settings = {},
    ipv6 = true,
  } = {},
) {
  const p = normalizeProfile(value),
    preferences = normalizeSettings(settings);
  const filterIpv6 = ipv6 === false || preferences.destinationFamily === 'ipv4';
  if (!['proxy', 'tun'].includes(mode)) throw Error('invalid connection mode.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('invalid local proxy port.');
  // bind only the core's own outer sockets; shared edge addresses stay inside the tun.
  const proxy = {
    type: 'vless',
    tag: 'proxy',
    server:
      (preferences.ipPreference === 'auto'
        ? endpointIPs[0]
        : endpointIPs.find((ip) => isIP(ip) === (preferences.ipPreference === 'ipv6' ? 6 : 4))) ||
      endpointIPs[0] ||
      p.server,
    server_port: p.port,
    uuid: p.uuid,
    packet_encoding: preferences.udpEncoding,
    connect_timeout: preferences.connectTimeout + 's',
    ...(p.tls
      ? { tls: { enabled: true, server_name: p.serverName, min_version: preferences.tlsMin } }
      : {}),
    ...(p.transport === 'ws'
      ? { transport: { type: 'ws', path: p.path, headers: { Host: p.serverName } } }
      : {}),
    domain_resolver: 'bootstrap',
  };
  const inbound = { type: 'mixed', tag: 'local', listen: '127.0.0.1', listen_port: port };
  const inbounds = [inbound];
  if (mode === 'tun') {
    if (!['darwin', 'win32', 'linux'].includes(platform))
      throw Error('full-device routing is unsupported on this system.');
    if (!endpointIPs.length || endpointIPs.some((ip) => !isIP(ip)))
      throw Error('resolve the server before enabling full-device routing.');
    inbounds.push({
      type: 'tun',
      tag: 'device',
      interface_name: platform === 'darwin' ? 'utun188' : 'nightwire',
      address: ['172.29.255.1/30', 'fdfe:dcba:9876::1/126'],
      mtu: preferences.mtu,
      auto_route: true,
      strict_route: true,
      dns_mode: 'hijack',
      stack: preferences.stack,
    });
  }
  return {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        { type: 'local', tag: 'bootstrap' },
        resolver('remote', 'proxy', preferences.dnsProvider),
      ],
      final: 'remote',
      ...(filterIpv6
        ? { rules: [{ query_type: ['AAAA', 'HTTPS'], action: 'predefined', rcode: 'NOERROR' }] }
        : {}),
      strategy: filterIpv6
        ? 'ipv4_only'
        : preferences.ipPreference === 'ipv6'
          ? 'prefer_ipv6'
          : 'prefer_ipv4',
    },
    inbounds,
    outbounds: [proxy, { type: 'direct', tag: 'direct' }],
    route: {
      auto_detect_interface: true,
      default_domain_resolver: 'bootstrap',
      rules: [
        { inbound: ['device'], port: 53, action: 'hijack-dns' },
        ...(filterIpv6 ? [{ inbound: ['device'], ip_version: 6, action: 'reject' }] : []),
      ],
      final: 'proxy',
    },
  };
}
export function serverConfig(users, { port = 2087, path = '/nightwire' } = {}) {
  if (!Array.isArray(users) || !users.length) throw Error('at least one user is required.');
  const names = new Set(),
    ids = new Set();
  const accounts = users
    .filter((u) => u.enabled !== false)
    .map((u) => {
      if (
        !/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(u.name) ||
        !UUID.test(u.uuid) ||
        names.has(u.name) ||
        ids.has(u.uuid)
      )
        throw Error('invalid or duplicate server user.');
      names.add(u.name);
      ids.add(u.uuid);
      return { name: u.name, uuid: u.uuid };
    });
  if (!accounts.length) throw Error('at least one active user is required.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^\/[a-zA-Z0-9_/-]+$/.test(path))
    throw Error('invalid server listener.');
  // resolve first so a public-looking hostname cannot rebind into the home lan.
  return {
    log: { level: 'warn', timestamp: true },
    dns: { servers: [resolver('public')], final: 'public', strategy: 'prefer_ipv4' },
    inbounds: [
      {
        type: 'vless',
        tag: 'friends',
        listen: '127.0.0.1',
        listen_port: port,
        users: accounts,
        transport: { type: 'ws', path },
      },
    ],
    outbounds: [{ type: 'direct', tag: 'internet' }],
    route: {
      default_domain_resolver: 'public',
      rules: [
        { action: 'resolve', strategy: 'prefer_ipv4' },
        { ip_cidr: PRIVATE_NETS, action: 'reject' },
      ],
      final: 'internet',
    },
  };
}
