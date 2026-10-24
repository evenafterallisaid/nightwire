import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { clientConfig, normalizeProfile } from './config.mjs';
import { connectSocket, diagnostics } from './probes.mjs';
import { probeDevice } from './device.mjs';
import net from 'node:net';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shellQuote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const psQuote = (s) => "'" + s.replaceAll("'", "''") + "'";
export class SessionManager {
  constructor({ core, runtime, worker, directory, onChange = () => {}, nodeRuntime = false }) {
    Object.assign(this, { core, runtime, worker, directory, onChange, nodeRuntime });
    this.state = { status: 'disconnected', mode: null, checks: null, error: null, logs: '' };
    this.session = null;
    this.busy = false;
  }
  snapshot() {
    return { ...this.state, busy: this.busy };
  }
  update(values) {
    Object.assign(this.state, values);
    this.onChange();
  }
  async cleanupPrevious() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!name.startsWith('session-')) continue;
      const dir = join(this.directory, name);
      let spec, state;
      try {
        spec = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'));
        state = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8'));
      } catch {
        continue;
      }
      try {
        await fetch(`http://127.0.0.1:${state.port}/stop`, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + spec.token },
          signal: AbortSignal.timeout(1500),
        });
      } catch {}
      let stopped = false;
      for (let n = 0; n < 260; n++) {
        try {
          state = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8'));
          if (!state.running && state.stopReason) {
            stopped = true;
            break;
          }
        } catch {}
        await sleep(100);
      }
      if (!stopped)
        throw Error(
          'a previous tunnel has not confirmed shutdown; its recovery files were retained. wait 30 seconds and reopen nightwire',
        );
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  async request(path, method = 'GET') {
    const s = this.session;
    if (!s?.port) throw Error('the tunnel controller is unavailable');
    const response = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: 'Bearer ' + s.token },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw Error('the tunnel controller refused the request');
    return response.json();
  }
  async launch(profile, mode) {
    const p = normalizeProfile(profile);
    const answers = await lookup(p.server, { all: true });
    const listener = net.createServer();
    await new Promise((r, j) => {
      listener.once('error', j);
      listener.listen(0, '127.0.0.1', r);
    });
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(this.directory, 'session-'));
    const token = randomBytes(32).toString('hex'),
      config = join(dir, 'config.json'),
      statusFile = join(dir, 'status.json'),
      manifest = join(dir, 'session.json');
    const meter = net.createServer();
    await new Promise((r, j) => {
      meter.once('error', j);
      meter.listen(0, '127.0.0.1', r);
    });
    const metricsPort = meter.address().port;
    await new Promise((r) => meter.close(r));
    const generated = clientConfig(p, { mode, port, endpointIPs: answers.map((x) => x.address) });
    generated.experimental = {
      clash_api: {
        external_controller: '127.0.0.1:' + metricsPort,
        secret: token,
        access_control_allow_origin: ['http://127.0.0.1'],
        access_control_allow_private_network: false,
      },
    };
    await writeFile(config, JSON.stringify(generated), { mode: 0o600 });
    await writeFile(
      manifest,
      JSON.stringify({ version: 1, core: this.core, config, statusFile, token, metricsPort }),
      { mode: 0o600 },
    );
    this.session = { dir, token, localPort: port, port: null, child: null, heartbeat: null };
    let command,
      args,
      env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    // elevation applies to this worker, while the window keeps normal user privileges.
    if (mode === 'tun' && process.platform === 'darwin') {
      command = '/usr/bin/osascript';
      const launch = `ELECTRON_RUN_AS_NODE=1 ${shellQuote(this.runtime)} ${shellQuote(this.worker)} ${shellQuote(manifest)}`;
      args = ['-e', `do shell script ${JSON.stringify(launch)} with administrator privileges`];
    } else if (mode === 'tun' && process.platform === 'win32') {
      command = 'powershell.exe';
      const inner = `$env:ELECTRON_RUN_AS_NODE='1'; & ${psQuote(this.runtime)} ${psQuote(this.worker)} ${psQuote(manifest)}; exit $LASTEXITCODE`;
      const encoded = Buffer.from(inner, 'utf16le').toString('base64');
      const outer = `$p=Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand','${encoded}') -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
      args = [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(outer, 'utf16le').toString('base64'),
      ];
    } else if (mode === 'tun') throw Error('full-device routing is available on macos and windows');
    else {
      command = this.runtime;
      args = [this.worker, manifest];
    }
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    this.session.child = child;
    let launchError = '';
    child.stderr.on('data', (d) => (launchError = (launchError + d.toString()).slice(-3000)));
    child.on('error', (e) => (launchError = e.message));
    for (let i = 0; i < 180; i++) {
      try {
        const s = JSON.parse(await readFile(statusFile, 'utf8'));
        this.session.port = s.port;
        if (s.error) throw Object.assign(Error(s.error), { workerFailed: true });
        if (s.running) {
          this.session.heartbeat = setInterval(() => this.maintain(), 1000);
          for (let n = 0; n < 40; n++) {
            try {
              (await connectSocket(port, '127.0.0.1', 500)).destroy();
              return port;
            } catch {
              await sleep(150);
            }
          }
          throw Object.assign(Error('the tunnel did not open its local listener'), {
            workerFailed: true,
          });
        }
      } catch (e) {
        if (e.workerFailed) throw e;
      }
      if (child.exitCode !== null)
        throw Error(
          launchError.trim() || 'administrator access was cancelled or the tunnel could not start',
        );
      await sleep(500);
    }
    throw Error('administrator approval timed out');
  }
  async maintain() {
    if (!this.session || this.maintaining) return;
    const active = this.session;
    this.maintaining = true;
    try {
      await this.request('/heartbeat', 'POST');
      const s = await this.request('/status');
      if (!s.running) throw Error(s.error || 'the tunnel stopped');
      if (this.session === active) this.update({ logs: s.logs, traffic: s.traffic });
    } catch (e) {
      if (this.session === active && !this.busy) {
        await this.stop();
        this.update({ status: 'failed', error: e.message });
      }
    } finally {
      this.maintaining = false;
    }
  }
  async disconnect() {
    const s = this.session;
    if (!s) return;
    clearInterval(s.heartbeat);
    try {
      await this.request('/stop', 'POST');
    } catch {}
    if (!s.port && s.child?.exitCode === null) s.child.kill('SIGTERM');
    let stopped = false;
    for (let i = 0; i < 260; i++) {
      try {
        const state = JSON.parse(await readFile(join(s.dir, 'status.json'), 'utf8'));
        if (!state.running) {
          if (state.traffic) this.update({ traffic: { ...state.traffic, upBps: 0, downBps: 0 } });
          stopped = true;
          break;
        }
      } catch {
        if (!s.child || s.child.exitCode !== null) {
          stopped = true;
          break;
        }
      }
      await sleep(100);
    }
    if (!stopped)
      throw Error('the tunnel has not confirmed shutdown; session recovery files were retained');
    await sleep(200);
    this.session = null;
    await rm(s.dir, { recursive: true, force: true }).catch(() => {});
  }
  async stop() {
    if (this.busy) return;
    this.busy = true;
    this.update({ status: 'disconnecting' });
    try {
      await this.disconnect();
      this.update({ status: 'disconnected', mode: null });
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
  async start(profile, { testOnly = false } = {}) {
    if (this.busy || this.session) throw Error('disconnect the current session first');
    this.busy = true;
    this.update({ status: 'checking', checks: null, error: null, logs: '', traffic: null });
    try {
      let port = await this.launch(profile, 'proxy');
      const checks = await diagnostics(port);
      this.update({ checks });
      await this.disconnect();
      if (!checks.web.ok)
        throw Error(checks.web.error || 'the home server could not reach the web');
      if (testOnly) {
        this.update({ status: 'disconnected', mode: null });
        return checks;
      }
      this.update({ status: 'authorizing' });
      port = await this.launch(profile, 'tun');
      this.update({ status: 'checking', mode: 'tun' });
      const [fullChecks, device] = await Promise.all([
        diagnostics(port),
        probeDevice().then(
          (value) => value,
          (error) => ({ ok: false, error: error.message }),
        ),
      ]);
      fullChecks.device = device;
      this.update({ checks: fullChecks });
      if (!device.ok) throw Error(device.error);
      if (!fullChecks.web.ok)
        throw Error(fullChecks.web.error || 'the tunnel failed after changing routes');
      this.update({
        status: fullChecks.udp.ok ? 'connected' : 'limited',
        mode: 'tun',
        checks: fullChecks,
      });
      return fullChecks;
    } catch (e) {
      await this.disconnect();
      this.update({ status: 'failed', mode: null, error: e.message });
      throw e;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
}
