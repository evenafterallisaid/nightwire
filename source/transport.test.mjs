import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { clientConfig, serverConfig } from './config.mjs';
import { connectSocket, udpExchange } from './probes.mjs';
const binary =
  process.env.SING_BOX ||
  process.env.SING_BOX ||
  resolve(
    import.meta.dirname,
    '../backend',
    process.platform === 'win32' ? 'windows-amd64' : 'darwin-arm64',
    process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
  );
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function run(config, dir, name) {
  const file = join(dir, name + '.json');
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  const c = spawn(binary, ['run', '-c', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  c.stderr.on('data', (x) => (err += x));
  c.logs = () => name + ': ' + err;
  c.on('error', () => {});
  for (let i = 0; i < 80; i++) {
    if (c.exitCode !== null) throw Error(err);
    try {
      (await connectSocket(config.inbounds[0].listen_port, '127.0.0.1', 100)).destroy();
      return c;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  c.kill();
  throw Error('backend listener did not open: ' + err);
}
async function stop(c) {
  if (!c || c.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => c.kill('SIGKILL'), 2500);
    c.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    c.kill('SIGTERM');
  });
}
async function httpViaProxy(port, targetPort) {
  const s = await connectSocket(port, '127.0.0.1', 3000);
  try {
    s.write(
      `GET http://127.0.0.1:${targetPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`,
    );
    return await new Promise((resolve, reject) => {
      let value = '';
      s.on('data', (d) => (value += d));
      s.on('end', () => resolve(value));
      s.on('error', reject);
    });
  } finally {
    s.destroy();
  }
}
test(
  'real websocket transport carries tcp and udp, rejects private targets and invalid logins',
  { timeout: 25000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nightwire-test-'));
    const children = [];
    let stage = 'setup';
    const udp = dgram.createSocket('udp4');
    const web = createServer((q, s) => s.end('nightwire transport ok'));
    const blocked = createServer((q, s) => s.end('this must not be reachable'));
    try {
      await new Promise((r) => web.listen(0, '127.0.0.1', r));
      await new Promise((r) => blocked.listen(0, '127.0.0.1', r));
      await new Promise((r) => udp.bind(0, '127.0.0.1', r));
      udp.on('message', (m, r) => udp.send(m, r.port, r.address));
      const uuid = randomUUID(),
        remote = await freePort(),
        local = await freePort(),
        bad = await freePort(),
        metricsPort = await freePort(),
        secret = randomUUID();
      const server = serverConfig([{ name: 'test', uuid }], {
        port: remote,
        path: '/transport-test',
      });
      server.route.rules.splice(1, 0, {
        ip_cidr: ['127.0.0.1/32'],
        port: [web.address().port, udp.address().port],
        action: 'route',
        outbound: 'internet',
      });
      children.push(await run(server, dir, 'server'));
      const p = {
        server: '127.0.0.1',
        port: remote,
        uuid,
        tls: false,
        transport: 'ws',
        path: '/transport-test',
      };
      const client = clientConfig(p, { port: local });
      client.experimental = {
        clash_api: { external_controller: '127.0.0.1:' + metricsPort, secret },
      };
      children.push(await run(client, dir, 'client'));
      stage = 'tcp';
      assert.match(await httpViaProxy(local, web.address().port), /nightwire transport ok/);
      stage = 'udp';
      const payload = Buffer.from('udp survived the websocket');
      assert.deepEqual(await udpExchange(local, '127.0.0.1', udp.address().port, payload), payload);
      stage = 'real traffic counters';
      assert.equal((await fetch(`http://127.0.0.1:${metricsPort}/connections`)).status, 401);
      const counters = await (
        await fetch(`http://127.0.0.1:${metricsPort}/connections`, {
          headers: { authorization: 'Bearer ' + secret },
        })
      ).json();
      assert.ok(counters.uploadTotal > 0);
      assert.ok(counters.downloadTotal > 0);
      stage = 'private target rejection';
      assert.doesNotMatch(
        await httpViaProxy(local, blocked.address().port).catch((e) => {
          if (e.code === 'ECONNRESET') return '';
          throw e;
        }),
        /this must not be reachable/,
      );
      stage = 'invalid login';
      children.push(
        await run(clientConfig({ ...p, uuid: randomUUID() }, { port: bad }), dir, 'bad-client'),
      );
      assert.doesNotMatch(
        await httpViaProxy(bad, web.address().port).catch((e) => {
          if (e.code === 'ECONNRESET') return '';
          throw e;
        }),
        /nightwire transport ok/,
      );
    } catch (e) {
      throw Error(
        stage +
          ': ' +
          e.message +
          '\n' +
          children
            .map((c) => c.logs())
            .join('\n')
            .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '[login]'),
      );
    } finally {
      await Promise.all(children.map(stop));
      udp.close();
      web.closeAllConnections();
      blocked.closeAllConnections();
      await Promise.all([new Promise((r) => web.close(r)), new Promise((r) => blocked.close(r))]);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
