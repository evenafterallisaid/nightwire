import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, trafficChart, formatRate } from './traffic.mjs';
test('traffic plot uses real elapsed time, clips old samples and labels a shared rate scale', () => {
  const plot = trafficChart([
    { time: 1000, up: 999999, down: 0 },
    { time: 62000, up: 1024, down: 2048 },
    { time: 92000, up: 4096, down: 8192 },
  ]);
  assert.equal(plot.visible.length, 2);
  assert.equal(plot.scale, 10000);
  assert.equal(plot.x(62000), 300);
  assert.equal(plot.x(92000), 600);
  assert.ok(plot.y(8192) < plot.y(4096));
  assert.match(plot.paths[1], /^M300\.0,/);
  assert.equal(formatBytes(2097152), '2.0 mb');
  assert.equal(formatBytes(0), '0 b');
});

test('graph history and speed units stay meaningful when preferences change', () => {
  const points = [
    { time: 1000, up: 100, down: 200 },
    { time: 61000, up: 800, down: 900 },
  ];
  assert.equal(trafficChart(points, { windowSeconds: 30 }).visible.length, 1);
  assert.equal(trafficChart(points, { windowSeconds: 300 }).visible.length, 2);
  assert.equal(formatRate(125000, 'bits'), '1.0 mbps');
});
