import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const run = promisify(execFile);
export async function probeDevice() {
  const start = Date.now();
  if (process.platform === 'darwin') {
    for (const args of [
      ['-n', 'get', '1.1.1.1'],
      ['-n', 'get', '-inet6', '2606:4700:4700::1111'],
    ]) {
      const { stdout } = await run('/sbin/route', args, { timeout: 5000 });
      if (!/interface:\s+utun188\b/.test(stdout))
        throw Error('the operating system has not selected the nightwire route');
    }
  } else if (process.platform === 'win32') {
    const command =
      "@('1.1.1.1','2606:4700:4700::1111') | ForEach-Object { (Find-NetRoute -RemoteIPAddress $_ -ErrorAction Stop | Select-Object -First 1).InterfaceAlias }";
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 10000, windowsHide: true },
    );
    if (
      stdout
        .trim()
        .split(/\r?\n/)
        .some((x) => x.trim() !== 'nightwire') ||
      stdout.trim().split(/\r?\n/).length !== 2
    )
      throw Error('the operating system has not selected the nightwire route');
  } else throw Error('device checks require macos or windows');
  await lookup('example.com');
  await new Promise((resolve, reject) => {
    // no proxy agent here: this request must use the operating system's routes.
    const request = https.request(
      'https://discord.com/',
      { method: 'HEAD', agent: false },
      (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 400) resolve();
        else reject(Error('the device web check returned ' + response.statusCode));
      },
    );
    request.setTimeout(12000, () => request.destroy(Error('the device web check timed out')));
    request.on('error', reject);
    request.end();
  });
  return { ok: true, elapsedMs: Date.now() - start };
}
