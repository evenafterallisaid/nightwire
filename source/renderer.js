import { formatBytes as bytes, trafficChart, formatRate } from './traffic.mjs';
const $ = (id) => document.getElementById(id);
let state = { profiles: [], status: 'disconnected' },
  pending = false;
const themes = ['midnight', 'paper', 'ember', 'abyss', 'moss', 'plum', 'ocean', 'rose', 'system'];
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let selectedTheme = 'midnight',
  firstSettings = true;
function theme(name) {
  if (!themes.includes(name)) name = 'midnight';
  selectedTheme = name;
  document.documentElement.dataset.theme =
    name === 'system' ? (systemTheme.matches ? 'midnight' : 'paper') : name;
  for (const button of document.querySelectorAll('button[data-theme]'))
    button.setAttribute('aria-pressed', String(button.dataset.theme === name));
  try {
    localStorage.setItem('nightwire-theme', name);
  } catch {}
}
let savedTheme;
try {
  savedTheme = localStorage.getItem('nightwire-theme');
} catch {}
theme(savedTheme);
for (const button of document.querySelectorAll('button[data-theme]'))
  button.onclick = () => changeSetting({ theme: button.dataset.theme });
systemTheme.onchange = () => {
  if (selectedTheme === 'system') theme('system');
};
function rate(value) {
  return formatRate(value, state.settings?.rateUnit || 'bytes');
}
function plotOptions() {
  return { windowSeconds: state.settings?.chartSeconds || 60 };
}
async function changeSetting(patch) {
  try {
    $('settings-error').textContent = '';
    await request('settings', patch);
  } catch (e) {
    $('settings-error').textContent = e.message;
  }
}
function view(name) {
  document.body.dataset.view = name;
  $('page-title').textContent = name;
  $('settings-dialog').hidden = name !== 'settings';
  $('connection-workspace').hidden = name === 'settings';
  for (const button of document.querySelectorAll('button[data-view]')) {
    if (button.dataset.view === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
for (const button of document.querySelectorAll('button[data-view]'))
  button.onclick = () => view(button.dataset.view);
$('close-settings').onclick = $('settings-done').onclick = () => view('connection');
for (const input of document.querySelectorAll('[data-setting]'))
  input.onchange = () =>
    changeSetting({
      [input.dataset.setting]: input.hasAttribute('data-number')
        ? Number(input.value)
        : input.value,
    });
$('reset-settings').onclick = () =>
  changeSetting({
    theme: 'midnight',
    rateUnit: 'bytes',
    chartSeconds: 60,
    dnsProvider: 'cloudflare',
    tlsMin: '1.2',
    mtu: 1400,
    ipPreference: 'ipv4',
    stack: 'mixed',
    connectTimeout: 20,
    udpEncoding: 'xudp',
  });
const history = [];
let lastSample = 0;
function renderTraffic(traffic, connected) {
  const fresh = traffic && Date.now() - traffic.updatedAt < 5000;
  $('upload-rate').textContent = connected && fresh ? rate(traffic.upBps) : connected ? '…' : '—';
  $('download-rate').textContent =
    connected && fresh ? rate(traffic.downBps) : connected ? '…' : '—';
  $('upload-total').textContent = bytes(traffic?.uploaded || 0) + ' this session';
  $('download-total').textContent = bytes(traffic?.downloaded || 0) + ' this session';
  $('traffic-context').textContent = connected
    ? fresh
      ? 'live · last ' + plotOptions().windowSeconds + 's'
      : 'waiting for counters'
    : traffic
      ? 'last session'
      : 'waiting for a connection';
  if (!traffic && lastSample) {
    history.length = 0;
    lastSample = 0;
  }
  if (connected && fresh && traffic.updatedAt !== lastSample) {
    history.push({ time: traffic.updatedAt, up: traffic.upBps, down: traffic.downBps });
    while (history.length && history[0].time < traffic.updatedAt - 300000) history.shift();
    lastSample = traffic.updatedAt;
  }
  const plot = trafficChart(history, plotOptions());
  $('chart-top').textContent = rate(plot.scale);
  $('chart-mid').textContent = rate(plot.scale / 2);
  $('upload-line').setAttribute('d', plot.paths[0]);
  $('download-line').setAttribute('d', plot.paths[1]);
  $('chart-start').textContent = plotOptions().windowSeconds + 's ago';
  $('chart-middle').textContent = plotOptions().windowSeconds / 2 + 's ago';
  $('traffic-unit-label').textContent =
    'transfer speed · ' + (state.settings?.rateUnit === 'bits' ? 'bits' : 'bytes') + ' per second';
  $('chart-now').textContent = connected ? 'now' : 'session end';
  $('traffic-graph').setAttribute(
    'aria-label',
    `upload and download over the last ${plotOptions().windowSeconds} seconds. scale zero to ${rate(plot.scale)}. use left and right arrow keys to inspect samples.`,
  );
}

function inspectSample(index) {
  const plot = trafficChart(history, plotOptions()),
    point = plot.visible[index];
  if (!point) return;
  const x = plot.x(point.time);
  $('chart-cursor').setAttribute('x1', x);
  $('chart-cursor').setAttribute('x2', x);
  $('chart-cursor').setAttribute('visibility', 'visible');
  $('traffic-tooltip').hidden = false;
  $('traffic-tooltip').textContent =
    `${Math.round((plot.end - point.time) / 1000)}s ago · ↑ ${rate(point.up)} · ↓ ${rate(point.down)}`;
  $('traffic-tooltip').style.left =
    Math.max(
      0,
      Math.min(
        $('traffic-graph').clientWidth - $('traffic-tooltip').offsetWidth,
        (x / 600) * $('traffic-graph').clientWidth,
      ),
    ) + 'px';
}
let inspected = -1;
$('traffic-graph').onpointermove = (event) => {
  const rect = event.currentTarget.getBoundingClientRect(),
    plot = trafficChart(history, plotOptions()),
    target =
      plot.end -
      plotOptions().windowSeconds * 1000 +
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
        plotOptions().windowSeconds *
        1000;
  inspected = plot.visible.reduce(
    (best, point, index) =>
      best < 0 || Math.abs(point.time - target) < Math.abs(plot.visible[best].time - target)
        ? index
        : best,
    -1,
  );
  inspectSample(inspected);
};
function hideInspection() {
  $('traffic-tooltip').hidden = true;
  $('chart-cursor').setAttribute('visibility', 'hidden');
}
$('traffic-graph').onpointerleave = hideInspection;
$('traffic-graph').onblur = hideInspection;
$('traffic-graph').onfocus = () => {
  inspected = trafficChart(history, plotOptions()).visible.length - 1;
  inspectSample(inspected);
};
$('traffic-graph').onkeydown = (event) => {
  if (event.key === 'Escape') return hideInspection();
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  inspected = Math.max(
    0,
    Math.min(
      trafficChart(history, plotOptions()).visible.length - 1,
      inspected + (event.key === 'ArrowLeft' ? -1 : 1),
    ),
  );
  inspectSample(inspected);
};
const busyStates = new Set(['checking', 'authorizing', 'disconnecting']);
function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function render(next) {
  state = next;
  const connected = ['connected', 'limited'].includes(state.status),
    busy = state.busy || busyStates.has(state.status) || pending;
  if (state.settings) {
    if (firstSettings && !state.settingsSaved && savedTheme && themes.includes(savedTheme)) {
      firstSettings = false;
      changeSetting({ theme: savedTheme });
    } else {
      firstSettings = false;
      theme(state.settings.theme);
    }
    for (const input of document.querySelectorAll('[data-setting]')) {
      input.value = String(state.settings[input.dataset.setting]);
      input.disabled = input.hasAttribute('data-connection') && (connected || busy);
    }
    $('reset-settings').disabled = connected || busy;
    $('connection-settings-note').textContent = connected
      ? 'disconnect to change connection settings.'
      : 'changes take effect on the next connection.';
  }
  document.body.dataset.platform = state.platform;
  document.body.className = state.status;
  $('version').textContent = 'v' + state.version;
  $('status-pill').textContent =
    {
      disconnected: 'offline',
      checking: 'checking',
      authorizing: 'needs approval',
      connected: 'connected',
      limited: 'udp needs attention',
      disconnecting: 'disconnecting',
      failed: 'connection failed',
    }[state.status] || state.status;
  const profile = state.profiles.find((x) => x.id === state.activeId);
  $('connection-name').textContent = profile ? profile.name : 'choose a connection';
  $('headline').textContent =
    {
      connected: 'connected',
      limited: 'limited connection',
      checking: 'checking connection',
      authorizing: 'authorization required',
      disconnecting: 'disconnecting',
      failed: 'connection failed',
    }[state.status] || 'disconnected';
  $('endpoint-address').textContent = profile
    ? profile.server + ':' + profile.port
    : 'no invite selected';
  $('detail-transport').textContent = profile
    ? profile.transport === 'ws'
      ? 'websocket'
      : 'tcp'
    : '—';
  $('detail-tls').textContent = profile
    ? profile.tls === false
      ? 'local test'
      : (state.settings?.tlsMin || '1.2') + '+'
    : '—';
  $('detail-dns').textContent = state.settings?.dnsProvider || 'cloudflare';
  $('detail-udp').textContent = state.settings?.udpEncoding || 'xudp';
  $('detail-mtu').textContent = state.settings?.mtu || 1400;
  const seconds = state.startedAt
    ? Math.max(
        0,
        Math.floor(
          ((connected ? Date.now() : state.endedAt || Date.now()) - state.startedAt) / 1000,
        ),
      )
    : null;
  $('session-length').textContent =
    seconds === null
      ? '—'
      : Math.floor(seconds / 3600)
          .toString()
          .padStart(2, '0') +
        ':' +
        Math.floor((seconds % 3600) / 60)
          .toString()
          .padStart(2, '0') +
        ':' +
        (seconds % 60).toString().padStart(2, '0');
  $('statusbar-message').textContent = state.status === 'disconnected' ? 'ready' : state.status;
  $('description').textContent =
    {
      connected: 'this device’s traffic is going through your home server.',
      limited:
        'the web check passed, but the udp check failed. voice and games may need attention.',
      checking: 'checking the server before calling this a connection.',
      authorizing:
        'approve your operating system’s administrator prompt to enable system-wide routing.',
      disconnecting: 'stopping the tunnel and releasing its routes.',
      failed: 'check the message above, then try the connection test.',
    }[state.status] ||
    (profile
      ? 'ready when you are. connect to route this entire device through ' + profile.server + '.'
      : 'add your invite to send this device’s traffic through your home server.');
  $('connect').textContent = connected ? 'disconnect' : busy ? 'working…' : 'connect';
  $('connect').disabled = busy || !profile;
  $('test').disabled = busy || connected || !profile;
  $('export').disabled = busy || !profile;
  $('remove').disabled = busy || connected || !profile;
  $('add-invite').disabled = busy || connected;
  $('import-file').disabled = busy || connected;
  renderTraffic(state.traffic, connected);
  $('routing-note').textContent = connected
    ? 'closing nightwire disconnects. your normal connection returns.'
    : 'system-wide routing includes web, voice, and game traffic.';
  $('profiles').replaceChildren();
  if (!state.profiles.length) {
    const p = document.createElement('p');
    p.className = 'profile-empty';
    p.textContent = 'no invites yet. add one to get the packets moving.';
    $('profiles').append(p);
  }
  for (const p of state.profiles) {
    const button = document.createElement('button');
    button.className = 'profile-option' + (p.id === state.activeId ? ' selected' : '');
    button.disabled = busy || connected;
    const name = document.createElement('strong'),
      server = document.createElement('small');
    name.textContent = p.name;
    server.textContent = p.server;
    button.append(name, server);
    button.onclick = () => request('select', p.id);
    $('profiles').append(button);
  }
  for (const type of ['web', 'udp', 'device']) {
    const check = state.checks?.[type];
    $(type + '-dot').className = 'check-dot' + (check ? (check.ok ? ' pass' : ' fail') : '');
    $(type + '-result').textContent = check
      ? check.ok
        ? 'verified · ' + check.elapsedMs + ' ms'
        : 'failed'
      : 'not checked';
    $(type + '-result').title = check?.error || '';
  }
  $('check-context').textContent = state.checks ? 'latest transport check' : 'no checks yet';
  $('log-content').textContent = state.logs || 'nothing brewing yet.';
  error(state.error || state.startupError || '');
}
async function request(channel, ...args) {
  pending = true;
  render(state);
  try {
    const result = await window.nightwire.invoke(channel, ...args);
    if (!result.ok) throw Error(result.error);
    if (result.result?.profiles) render(result.result);
    return result.result;
  } catch (e) {
    error(e.message);
    throw e;
  } finally {
    pending = false;
    render({ ...state, error: $('error').hidden ? state.error : $('error').textContent });
  }
}
function openInvite() {
  $('invite-text').value = '';
  $('import-error').textContent = '';
  $('invite-dialog').showModal();
  $('invite-text').focus();
}
$('add-invite').onclick = openInvite;
$('close-dialog').onclick = () => $('invite-dialog').close();
$('import-file').onclick = () => request('import-file').catch(() => {});
$('dialog-import-file').onclick = async () => {
  try {
    await request('import-file');
    $('invite-dialog').close();
  } catch {}
};
$('invite-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await request('import-text', $('invite-text').value);
    $('invite-dialog').close();
    $('invite-text').value = '';
  } catch (e) {
    $('import-error').textContent = e.message;
  }
};
$('connect').onclick = () =>
  request(['connected', 'limited'].includes(state.status) ? 'disconnect' : 'connect').catch(
    () => {},
  );
$('test').onclick = () => request('test').catch(() => {});
$('export').onclick = () => request('export', state.activeId).catch(() => {});
$('remove').onclick = () => request('remove', state.activeId).catch(() => {});
window.nightwire.subscribe(render);
request('state').catch(() => {});
