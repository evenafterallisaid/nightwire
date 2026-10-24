import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';

export function readBytes(socket, count) {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    function cleanup() {
      socket.off('data', ondata);
      socket.off('error', fail);
      socket.off('end', ended);
    }
    function fail(e) {
      cleanup();
      reject(e);
    }
    function ended() {
      fail(Error('the connection closed early'));
    }
    function ondata(chunk) {
      data = Buffer.concat([data, chunk]);
      if (data.length >= count) {
        socket.pause();
        cleanup();
        if (data.length > count) socket.unshift(data.subarray(count));
        resolve(data.subarray(0, count));
      }
    }
    socket.on('data', ondata);
    socket.once('error', fail);
    socket.once('end', ended);
    socket.resume();
  });
}
export async function connectSocket(port, host = '127.0.0.1', timeout = 10000) {
  const socket = net.createConnection({ port, host });
  socket.setTimeout(timeout, () => socket.destroy(Error('connection timed out')));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}
async function headers(socket) {
  let result = '';
  while (!result.endsWith('\r\n\r\n')) {
    result += (await readBytes(socket, 1)).toString('latin1');
    if (result.length > 16384) throw Error('oversized proxy response');
  }
  return result;
}
export async function probeWeb(port, { host = 'discord.com', timeout = 12000 } = {}) {
  const start = Date.now();
  let socket;
  try {
    socket = await connectSocket(port, '127.0.0.1', timeout);
    socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
    if (!/^HTTP\/1\.[01] 200\b/.test(await headers(socket)))
      throw Error('the proxy could not connect to the website');
    const raw = socket;
    socket = tls.connect({ socket: raw, servername: host, rejectUnauthorized: true });
    socket.setTimeout(timeout, () => socket.destroy(Error('web check timed out')));
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
      socket.resume();
    });
    socket.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    const response = await headers(socket);
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(response)?.[1]);
    if (status < 200 || status >= 400 || !status)
      throw Error(`website returned ${status || 'an invalid response'}`);
    return { ok: true, elapsedMs: Date.now() - start, httpStatus: status };
  } finally {
    socket?.destroy();
  }
}
export async function socksUdp(port, { timeout = 8000 } = {}) {
  const control = await connectSocket(port, '127.0.0.1', timeout);
  try {
    control.write(Buffer.from([5, 1, 0]));
    const greeting = await readBytes(control, 2);
    if (greeting[0] !== 5 || greeting[1] !== 0) throw Error('socks authentication was refused');
    control.write(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0]));
    const head = await readBytes(control, 4);
    if (head[0] !== 5 || head[1] !== 0) throw Error('udp association was refused');
    let address;
    if (head[3] === 1) address = [...(await readBytes(control, 4))].join('.');
    else if (head[3] === 3)
      address = (await readBytes(control, (await readBytes(control, 1))[0])).toString();
    else if (head[3] === 4) {
      await readBytes(control, 16);
      address = '::1';
    } else throw Error('invalid udp association address');
    const boundPort = (await readBytes(control, 2)).readUInt16BE();
    return { control, address: address === '0.0.0.0' ? '127.0.0.1' : address, port: boundPort };
  } catch (e) {
    control.destroy();
    throw e;
  }
}
export async function udpExchange(
  port,
  address,
  destinationPort,
  payload,
  { timeout = 8000 } = {},
) {
  if (net.isIP(address) !== 4) throw Error('udp diagnostic requires an ipv4 target');
  const assoc = await socksUdp(port, { timeout });
  const socket = dgram.createSocket('udp4');
  try {
    const header = Buffer.from([
      0,
      0,
      0,
      1,
      ...address.split('.').map(Number),
      destinationPort >> 8,
      destinationPort & 255,
    ]);
    const packet = Buffer.concat([header, payload]);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('udp response timed out')), timeout);
      socket.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      socket.once('message', (data) => {
        clearTimeout(timer);
        if (data.length < 10 || data[2] !== 0 || data[3] !== 1)
          return reject(Error('invalid udp reply'));
        resolve(data.subarray(10));
      });
      socket.send(packet, assoc.port, assoc.address, (e) => {
        if (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  } finally {
    socket.close();
    assoc.control.destroy();
  }
}
export async function probeUdp(port, { timeout = 8000 } = {}) {
  const id = randomBytes(2);
  const name = Buffer.concat(
    'example.com'.split('.').map((x) => Buffer.concat([Buffer.from([x.length]), Buffer.from(x)])),
  );
  const query = Buffer.concat([
    id,
    Buffer.from([1, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    name,
    Buffer.from([0, 0, 1, 0, 1]),
  ]);
  const start = Date.now();
  const answer = await udpExchange(port, '1.1.1.1', 53, query, { timeout });
  if (
    answer.length < 12 ||
    !answer.subarray(0, 2).equals(id) ||
    !(answer[2] & 128) ||
    (answer[3] & 15) !== 0 ||
    answer.readUInt16BE(6) < 1
  )
    throw Error('invalid dns response over udp');
  return { ok: true, elapsedMs: Date.now() - start, target: 'dns over udp' };
}
export async function diagnostics(port) {
  const result = await Promise.allSettled([probeWeb(port), probeUdp(port)]);
  return Object.fromEntries(
    result.map((r, i) => [
      ['web', 'udp'][i],
      r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason.message },
    ]),
  );
}
