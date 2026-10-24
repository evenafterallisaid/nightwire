export function formatBytes(value) {
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return (i ? value.toFixed(value < 10 ? 1 : 0) : Math.round(value)) + ' ' + units[i];
}
export function trafficChart(samples, { windowSeconds = 60 } = {}) {
  const windowMs = windowSeconds * 1000;
  const end = samples.at(-1)?.time || Date.now();
  const visible = samples.filter((point) => point.time >= end - windowMs && point.time <= end);
  const peak = Math.max(1024, ...visible.flatMap((point) => [point.up, point.down]));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const scale = [1, 2, 5, 10].map((x) => x * magnitude).find((x) => x >= peak);
  const x = (time) => Math.max(0, Math.min(600, ((time - end + windowMs) / windowMs) * 600));
  const y = (rate) => 110 - (rate / scale) * 108;
  return {
    end,
    scale,
    visible,
    x,
    y,
    paths: ['up', 'down'].map((key) =>
      visible
        .map(
          (point, i) => `${i ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point[key]).toFixed(1)}`,
        )
        .join(' '),
    ),
  };
}

export function formatRate(value, unit = 'bytes') {
  if (unit !== 'bits') return formatBytes(value) + '/s';
  value *= 8;
  const units = ['bps', 'kbps', 'mbps', 'gbps'];
  let i = 0;
  while (value >= 1000 && i < 3) {
    value /= 1000;
    i++;
  }
  return (i ? value.toFixed(value < 10 ? 1 : 0) : Math.round(value)) + ' ' + units[i];
}
