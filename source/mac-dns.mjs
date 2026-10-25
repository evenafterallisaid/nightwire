import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
export const TUN_DNS = '172.29.255.2';
export function hasTunnelDns(text) {
  const first = text.split('DNS configuration (for scoped queries)')[0].split(/resolver #\d+\n/)[1];
  return !!first && /nameserver\[0\]\s*:\s*172\.29\.255\.2\s*(?:\n|$)/.test(first);
}

// temporary dynamic-store values belong to this open scutil session. eof also
// closes it if the worker crashes, so the user's persistent dns is never edited.
export async function installMacDns({ signal, onFailure }) {
  let tool,
    stopped = false,
    failure;
  const key = `State:/Network/Service/nightwire-${process.pid}/DNS`;
  async function cleanup() {
    stopped = true;
    if (!tool || tool.exitCode !== null || tool.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => tool.kill('SIGKILL'), 1000);
      tool.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      tool.stdin.end('quit\n');
    });
  }
  try {
    // do not send system lookups into an interface that has not appeared yet.
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const route = await run('/sbin/route', ['-n', 'get', TUN_DNS], { timeout: 2000 });
      if (/interface:\s+utun188\b/.test(route.stdout)) break;
      if (attempt >= 79) throw Error('the tunnel dns route did not appear');
      await delay(100, undefined, { signal });
    }
    tool = spawn('/usr/sbin/scutil', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    tool.stdout.resume();
    tool.stderr.resume();
    tool.stdin.on('error', () => {});
    tool.once('error', (error) => {
      failure = error;
    });
    tool.once('exit', () => {
      failure ||= Error('the temporary system dns session stopped');
      if (!stopped && !signal.aborted) onFailure(failure);
    });
    tool.stdin.write(
      [
        'd.init',
        `d.add ServerAddresses * ${TUN_DNS}`,
        'd.add SupplementalMatchDomains * ""',
        'd.add SupplementalMatchDomainsNoSearch # 1',
        'd.add SearchOrder # 1',
        `add ${key} temporary`,
        '',
      ].join('\n'),
    );
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      if (failure) throw failure;
      const { stdout } = await run('/usr/sbin/scutil', ['--dns'], { timeout: 2000 });
      if (hasTunnelDns(stdout)) break;
      if (attempt >= 49) throw Error('macos did not select the temporary tunnel dns resolver');
      await delay(100, undefined, { signal });
    }
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
