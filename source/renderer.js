const $ = (id) => document.getElementById(id);
let state = { profiles: [], status: 'disconnected' },
  pending = false;
const themes = ['midnight', 'paper', 'ember'];
function theme(name) {
  if (!themes.includes(name)) name = 'midnight';
  document.documentElement.dataset.theme = name;
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
  button.onclick = () => theme(button.dataset.theme);
const history = [];
let lastSample = 0;
function bytes(value) {
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return (i ? value.toFixed(value < 10 ? 1 : 0) : Math.round(value)) + ' ' + units[i];
}
function renderTraffic(traffic, connected) {
  const fresh = traffic && Date.now() - traffic.updatedAt < 5000;
  $('upload-rate').textContent =
    connected && fresh ? bytes(traffic.upBps) + '/s' : connected ? '…' : '—';
  $('download-rate').textContent =
    connected && fresh ? bytes(traffic.downBps) + '/s' : connected ? '…' : '—';
  $('upload-total').textContent = bytes(traffic?.uploaded || 0) + ' this session';
  $('download-total').textContent = bytes(traffic?.downloaded || 0) + ' this session';
  $('traffic-context').textContent = connected
    ? fresh
      ? 'live · last 60 samples'
      : 'waiting for counters'
    : traffic
      ? 'last session'
      : 'waiting for a connection';
  if (!traffic && lastSample) {
    history.length = 0;
    lastSample = 0;
  }
  if (connected && fresh && traffic.updatedAt !== lastSample) {
    history.push([traffic.upBps, traffic.downBps]);
    if (history.length > 60) history.shift();
    lastSample = traffic.updatedAt;
  }
  const max = Math.max(1024, ...history.flat());
  for (const [id, index] of [
    ['upload-line', 0],
    ['download-line', 1],
  ])
    $(id).setAttribute(
      'd',
      history
        .map(
          (point, i) =>
            (i ? 'L' : 'M') +
            ((i * 240) / 59).toFixed(1) +
            ',' +
            (44 - (point[index] / max) * 40).toFixed(1),
        )
        .join(' '),
    );
}
const busyStates = new Set(['checking', 'authorizing', 'disconnecting']);
function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function render(next) {
  state = next;
  const connected = ['connected', 'limited'].includes(state.status),
    busy = state.busy || busyStates.has(state.status) || pending;
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
  $('connection-name').textContent = profile ? profile.name : 'a way back home.';
  $('headline').textContent =
    {
      connected: 'you’re home.',
      limited: 'mostly home.',
      checking: 'checking the wire.',
      authorizing: 'one small permission.',
      disconnecting: 'heading back.',
      failed: 'a kink in the wire.',
    }[state.status] || 'take the long\nway home.';
  $('headline').style.whiteSpace = 'pre-line';
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
