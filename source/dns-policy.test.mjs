import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { clientConfig } from './config.mjs';
import { connectSocket } from './probes.mjs';
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
test(
  'an ipv4-only gateway never advertises aaaa or https ipv6 hints to browsers',
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nightwire-dns-'));
    let child;
    const udp = dgram.createSocket('udp4');
    try {
      const port = await freePort(),
        dnsPort = await freePort();
      const config = clientConfig(
        { server: '127.0.0.1', port: 2087, uuid: randomUUID(), tls: false },
        { port, ipv6: false },
      );
      config.inbounds.push({
        type: 'direct',
        tag: 'device',
        listen: '127.0.0.1',
        listen_port: dnsPort,
        network: 'udp',
        override_address: '1.1.1.1',
        override_port: 53,
      });
      const file = join(dir, 'config.json');
      await writeFile(file, JSON.stringify(config));
      const binary =
        process.env.SING_BOX ||
        resolve(
          import.meta.dirname,
          '../backend',
          process.platform === 'win32' ? 'windows-amd64' : 'darwin-arm64',
          process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
        );
      let logs = '';
      child = spawn(binary, ['run', '-c', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (d) => (logs += d));
      let ready = false;
      for (let i = 0; i < 160; i++) {
        try {
          (await connectSocket(port, '127.0.0.1', 100)).destroy();
          ready = true;
          break;
        } catch {}
        if (child.exitCode !== null) throw Error(logs);
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(ready, 'dns policy core did not start: ' + logs);
      for (const type of [28, 65]) {
        const query = Buffer.from([
          0x12,
          type,
          1,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          7,
          ...Buffer.from('example'),
          3,
          ...Buffer.from('com'),
          0,
          0,
          type,
          0,
          1,
        ]);
        const answer = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('dns policy query timed out')), 3000);
          udp.once('message', (packet) => {
            clearTimeout(timer);
            resolve(packet);
          });
          udp.send(query, dnsPort, '127.0.0.1');
        });
        assert.equal(answer[3] & 15, 0);
        assert.equal(answer.readUInt16BE(6), 0);
        assert.ok(answer[2] & 128);
      }
    } finally {
      try {
        udp.close();
      } catch {}
      if (child && child.exitCode === null) {
        child.kill();
        await new Promise((r) => child.once('exit', r));
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
);
