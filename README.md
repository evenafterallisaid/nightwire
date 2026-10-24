<p align="center"><img src="source/assets/mark.svg" width="88" alt="nightwire cable-loop logo"></p>

# nightwire

your connection, after hours.

nightwire sends your mac or windows device's traffic through a home gateway. web, dns, tcp, and udp all get a seat. the desktop app uses a real tun interface, verified tls, and a separate administrator worker that gives the routes back when you disconnect.

coffee was involved. certificate verification survived.

## grab a build

[download the latest release](https://github.com/evenafterallisaid/nightwire/releases). macos apple silicon gets a `.pkg`; windows x64 gets a `setup.exe`. intel macs and windows arm are not packaged in this release.

these beta installers have no developer-id notarization or authenticode signature. macos application code has an ad-hoc signature. use your operating system's documented approval flow only if you trust this source and its release checksums. the app asks for administrator approval when connecting; installation does not silently enable a tunnel.

1. install and open nightwire.
2. import your private `.nightwire` invite, or paste its vless link.
3. click **test connection** for an optional server check.
4. click **connect**, then approve the operating system's administrator prompt.
5. wait for web, udp, and device routes & dns to verify.

**disconnect** restores normal routing. closing the app also disconnects. a missed controller heartbeat stops the worker after about 20 seconds; forced termination may take a few more seconds. disconnect and close before upgrading or uninstalling. windows uninstall keeps encrypted invites; on macos, remove the app from applications after closing it.

## make it yours

the desktop workspace has connection, traffic, and settings views, native window controls, and eight themes plus system appearance. the graph has readable rate/time axes and sample inspection. choose a 30-second, 1-minute, or 5-minute window, and bytes or bits per second. rates and session totals come from actual tunnel counters. narrow scrollbars follow the theme.

[settings explained](docs/settings.md) covers verified tls requirements, encrypted dns providers, address selection, timeouts, mtu, network stacks, and udp compatibility. connection changes apply on the next connection. there is a reset-defaults button for the experiments that needed less coffee.

## what the checks actually say

- web: a verified https request through the gateway reaches discord's website.
- udp: a dns query and response cross a socks udp association, vless xudp, and the gateway.
- device routes & dns: both address families select the tun interface, system name resolution succeeds, and an https request made without a proxy agent works.

check times include setup. they are not ping measurements, proof of a working discord call, or a game-streaming benchmark. a successful test-connection preflight does not enable full-device routing.

this release has no kill switch. if the worker stops, normal internet access returns. there is no always-on background vpn or automatic reconnect. loopback communication remains local. other vpn clients, operating system route overrides, and applications that explicitly bind a physical interface can conflict with full-device routing.

## the home end

the included [windows gateway guide](docs/server.md) sets up a localhost-only service and a cloudflare tunnel hostname. each person gets their own login so one invite can be revoked without rotating everybody's access. the gateway rejects private home-network destinations, including names that resolve to private addresses.

cloudflare carries the outer websocket over https. udp packets travel inside that ordered tcp connection. packet loss can stall unrelated traffic, so this path can be fine for browsing while still feeling bad for fast games or voice. no promise of passing any particular network filter, and no youtube impersonation or certificate tricks.

cloudflare terminates the outer tls connection. ordinary https inside the proxy keeps its own end-to-end encryption, but cloudflare is part of the trust model for the proxy protocol. this is not a private mesh link to your home lan. high-bandwidth streaming also needs a suitable home uplink and a transport permitted by your provider's terms.

## build it with the lights off

node 24 or newer, npm, git, and native packaging tools are required. macos uses `pkgbuild`, `codesign`, `ditto`, and `iconutil`. windows needs nsis (`makensis` on path). build on the target platform for release testing.

```sh
npm ci
node scripts/fetch.mjs
npm test
npm run icons
```

then on macos:

```sh
NIGHTWIRE_ELECTRON_RUNTIME="$PWD/.cache/runtime-darwin/Electron.app" npm run build -- darwin
```

or powershell on windows:

```powershell
$env:NIGHTWIRE_ELECTRON_RUNTIME="$PWD\.cache\runtime-win32"
npm run build -- win32
```

`scripts/components.json` pins official downloads and sha256 checksums. the fetcher verifies each archive before extracting or executing it. `npm ci` pins the build dependencies. output goes in `dist/`; move an existing build aside before rebuilding.

tests exercise a real sing-box websocket server/client, authenticated control, tcp and udp transport, invalid logins, private destination rejection, encrypted invite storage, and controller-loss cleanup. ci also builds both installers and smoke-tests windows install/uninstall. real privileged routing still needs an operating system test; ci transport checks alone do not prove a campus connection.

## the less caffeinated details

[architecture and recovery](docs/architecture.md) · [privacy](docs/privacy.md) · [third-party notices](third-party.md) · [original-code license](LICENSE)

only original documentation, comments, and interface copy follow our lowercase habit. protocol identifiers, file paths, upstream licenses, and code that needs its capitals keep them. please do not commit invites, passwords, service tokens, or `private/` directories. the wire needs packets, not your secrets.
