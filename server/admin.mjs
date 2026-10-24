import { readFile, writeFile, mkdir, rename, copyFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { serverConfig, normalizeProfile, shareLink } from '../source/config.mjs';

const args = process.argv.slice(2),
  command = args.shift();
function option(name, fallback) {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
}
const root = resolve(
  option('dir', process.env.NIGHTWIRE_SERVER_DIR || resolve(import.meta.dirname, '..')),
);
const privateDir = join(root, 'private'),
  stateFile = join(privateDir, 'users.json'),
  configFile = join(root, 'config.json');
const binary = option(
  'core',
  join(root, 'bin', process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'),
);
function validName(name) {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name || ''))
    throw Error('use a lowercase name with letters, numbers, underscores, or dashes');
  return name;
}
async function load() {
  return JSON.parse(await readFile(stateFile, 'utf8'));
}
async function save(state) {
  const config = serverConfig(state.users, { port: state.port, path: state.path });
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const temp = configFile + '.next';
  await writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
  const check = spawnSync(binary, ['check', '-c', temp], { encoding: 'utf8', windowsHide: true });
  if (check.status !== 0)
    throw Error('server configuration failed validation; no active configuration was changed');
  try {
    await access(configFile);
    await copyFile(configFile, configFile + '.previous');
  } catch {}
  await writeFile(stateFile + '.next', JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temp, configFile);
  await rename(stateFile + '.next', stateFile);
  if (process.platform === 'win32' && !args.includes('--no-restart')) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$s=Get-Service nightwire -ErrorAction SilentlyContinue; if($s){Restart-Service nightwire -ErrorAction Stop}',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (result.status !== 0)
      throw Error(
        'configuration saved, but the service did not restart; run restart-service nightwire as administrator',
      );
  }
}
async function invite(state, name) {
  const user = state.users.find((x) => x.name === name && x.enabled !== false);
  if (!user) throw Error('no active user with that name');
  const profile = normalizeProfile({
    name: 'nightwire / ' + name,
    server: state.hostname,
    port: 443,
    uuid: user.uuid,
    transport: 'ws',
    path: state.path,
  });
  const dir = join(privateDir, 'invites');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, name + '.nightwire');
  await writeFile(file, JSON.stringify(profile, null, 2), { mode: 0o600 });
  await writeFile(join(dir, name + '.txt'), shareLink(profile) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ name, invite: file, shareLinkFile: join(dir, name + '.txt') }));
}
try {
  if (command === 'init') {
    try {
      await access(stateFile);
      throw Error('server already initialized; existing logins were left alone');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const name = validName(option('name', 'owner')),
      hostname = option('hostname');
    const uuid = randomUUID();
    normalizeProfile({ server: hostname, uuid });
    const state = {
      version: 1,
      hostname,
      port: 2087,
      path: '/nw-' + randomBytes(12).toString('hex'),
      users: [{ name, uuid, enabled: true, created: new Date().toISOString() }],
    };
    await save(state);
    await invite(state, name);
  } else if (command === 'add') {
    const state = await load(),
      name = validName(option('name'));
    if (state.users.some((x) => x.name === name))
      throw Error('that name already exists; choose another name');
    state.users.push({
      name,
      uuid: randomUUID(),
      enabled: true,
      created: new Date().toISOString(),
    });
    await save(state);
    await invite(state, name);
  } else if (command === 'revoke') {
    const state = await load(),
      name = validName(option('name')),
      user = state.users.find((x) => x.name === name);
    if (!user) throw Error('unknown user');
    if (state.users.filter((x) => x.enabled !== false && x.name !== name).length === 0)
      throw Error(
        'this is the last active login; stop and disable the service to close all access',
      );
    user.enabled = false;
    user.revoked = new Date().toISOString();
    await save(state);
    console.log(JSON.stringify({ name, revoked: true }));
  } else if (command === 'apply') {
    await save(await load());
    console.log(JSON.stringify({ applied: true }));
  } else if (command === 'list') {
    const state = await load();
    console.log(
      JSON.stringify(
        state.users.map(({ name, enabled, created, revoked }) => ({
          name,
          enabled,
          created,
          revoked,
        })),
        null,
        2,
      ),
    );
  } else if (command === 'export') await invite(await load(), validName(option('name')));
  else
    throw Error(
      'usage: node server/admin.mjs init --hostname home.example --name owner | add --name friend | revoke --name friend | list | apply | export --name owner',
    );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
