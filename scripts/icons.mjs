import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const assets = resolve(import.meta.dirname, '../source/assets');
const svg = readFileSync(assets + '/icon.svg');
function png(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}
writeFileSync(assets + '/icon.png', png(1024));
const image = png(256),
  header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(image.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync(assets + '/icon.ico', Buffer.concat([header, image]));
if (process.platform === 'darwin') {
  const dir = assets + '/nightwire.iconset';
  mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(`${dir}/icon_${size}x${size}.png`, png(size));
    writeFileSync(`${dir}/icon_${size}x${size}@2x.png`, png(size * 2));
  }
  const p = spawnSync('/usr/bin/iconutil', ['-c', 'icns', dir, '-o', assets + '/icon.icns'], {
    encoding: 'utf8',
  });
  if (p.status !== 0) throw Error(p.stderr);
}
console.log('nightwire icons rendered');
