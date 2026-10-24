import { cpSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ResEdit from 'resedit';
const root = resolve(import.meta.dirname, '..');
const target = process.argv[2] || process.platform;
const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
const runtime = process.env.NIGHTWIRE_ELECTRON_RUNTIME;
if (!runtime)
  throw Error('set NIGHTWIRE_ELECTRON_RUNTIME to the extracted official electron runtime');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
function run(command, args) {
  const p = spawnSync(command, args, { stdio: 'inherit' });
  if (p.status !== 0) throw Error(command + ' failed');
}
function resources(destination, platform) {
  mkdirSync(join(destination, 'app'), { recursive: true });
  cpSync(join(root, 'source'), join(destination, 'app'), {
    recursive: true,
    filter: (p) =>
      !p.endsWith('.test.mjs') && !p.endsWith('tun-smoke.mjs') && !p.includes('.iconset'),
  });
  const meta = JSON.parse(readFileSync(join(destination, 'app/package.json')));
  meta.version = version;
  writeFileSync(join(destination, 'app/package.json'), JSON.stringify(meta, null, 2));
  mkdirSync(join(destination, 'backend'), { recursive: true });
  cpSync(join(root, 'backend', platform), join(destination, 'backend', platform), {
    recursive: true,
  });
  for (const name of ['LICENSE', 'third-party.md', 'licenses'])
    if (existsSync(join(root, name)))
      cpSync(join(root, name), join(destination, 'app', name), { recursive: true });
}
if (target === 'darwin') {
  const app = join(dist, 'nightwire.app');
  if (existsSync(app))
    throw Error('the macos build directory already exists; choose a clean dist directory');
  run('/usr/bin/ditto', [resolve(runtime), app]);
  resources(join(app, 'Contents/Resources'), 'darwin-arm64');
  renameSync(join(app, 'Contents/MacOS/Electron'), join(app, 'Contents/MacOS/nightwire'));
  cpSync(join(root, 'source/assets/icon.icns'), join(app, 'Contents/Resources/nightwire.icns'));
  const file = join(app, 'Contents/Info.plist');
  let plist = readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries({
    CFBundleDisplayName: 'nightwire',
    CFBundleName: 'nightwire',
    CFBundleIdentifier: 'io.github.evenafterallisaid.nightwire',
    CFBundleExecutable: 'nightwire',
    CFBundleIconFile: 'nightwire.icns',
    CFBundleShortVersionString: '0.2.0',
    CFBundleVersion: '1',
  })) {
    const regex = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (regex.test(plist)) plist = plist.replace(regex, `$1${value}$2`);
    else
      plist = plist.replace(
        '</dict>\n</plist>',
        `<key>${key}</key><string>${value}</string>\n</dict>\n</plist>`,
      );
  }
  writeFileSync(file, plist);
  run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--preserve-metadata=entitlements,requirements,flags',
    app,
  ]);
  run('/usr/bin/pkgbuild', [
    '--component',
    app,
    '--identifier',
    'io.github.evenafterallisaid.nightwire',
    '--version',
    '0.2.0',
    '--install-location',
    '/Applications',
    join(dist, `nightwire-${version}-macos-arm64.pkg`),
  ]);
  console.log(app);
} else if (target === 'win32') {
  const app = join(dist, 'nightwire-windows-x64');
  if (existsSync(app))
    throw Error('the windows build directory already exists; choose a clean dist directory');
  cpSync(resolve(runtime), app, { recursive: true });
  resources(join(app, 'resources'), 'windows-amd64');
  const exe = ResEdit.NtExecutable.from(readFileSync(join(app, 'electron.exe')), {
    ignoreCert: true,
  });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(readFileSync(join(root, 'source/assets/icon.ico')));
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  if (!group) throw Error('electron icon group missing');
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group.id,
    group.lang,
    icon.icons.map((x) => x.data),
  );
  const info = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  info.setFileVersion(0, 2, 0, 1, 1033);
  info.setProductVersion(0, 2, 0, 1, 1033);
  info.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: 'nightwire',
      FileDescription: 'nightwire',
      CompanyName: 'nightwire contributors',
      OriginalFilename: 'nightwire.exe',
      InternalName: 'nightwire',
      LegalCopyright: 'copyright 2026 nightwire contributors',
    },
  );
  info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  writeFileSync(join(app, 'nightwire.exe'), Buffer.from(exe.generate()));
  const { unlinkSync } = await import('node:fs');
  unlinkSync(join(app, 'electron.exe'));
  const nsis = process.env.NIGHTWIRE_MAKENSIS || 'makensis';
  run(nsis, [
    '-DVERSION=' + version,
    '-DAPPDIR=' + app,
    '-DOUTDIR=' + dist,
    '-DASSETS=' + join(root, 'source/assets'),
    join(root, 'scripts/installer.nsi'),
  ]);
  console.log(app);
} else throw Error('supported targets: darwin, win32');
