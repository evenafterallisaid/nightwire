# packets, coffee, and a way back

```text
app ui → isolated preload → desktop controller
                                ↓ authenticated loopback control + heartbeat
                        elevated worker → sing-box tun
                                                ↓ vless + xudp inside websocket + tls
                                           cloudflare edge
                                                ↓ existing cloudflare tunnel
                                       localhost windows gateway → internet
```

before enabling routes, the controller checks actual ipv6 egress using a verified tls connection to a public ipv6 literal. when that fails, it captures ipv6 locally and suppresses aaaa and https dns answers that could send browsers toward unreachable destinations. the distinction matters: a tun interface can accept an ipv6 tcp handshake even when the gateway cannot carry its tls stream onward.

the desktop controller resolves the endpoint before installing routes and pins its address while preserving certificate and websocket host verification. sing-box binds its own outer connections to the physical interface. shared cloudflare edge addresses are not globally excluded from routing, because that would let unrelated sites on those addresses bypass the tunnel.

the ui stays unprivileged. only the small worker and core are elevated after the native administrator prompt. the worker validates the config, serves authenticated local control, keeps bounded logs, and stops the core when heartbeats disappear. macos uses a termination signal. windows requests a console control event before a bounded forced-stop fallback. a normal core shutdown removes its routes and tun interface.

on macos the worker opens a temporary system dns resolver for the tun address. its dynamic-store entry belongs to an open scutil session and disappears when that session closes, including when the worker loses its pipe. disconnect closes this resolver before stopping the core; persistent wi-fi dns preferences are never overwritten. connection verification checks that macos selected this resolver.

a force kill, machine crash, conflicting vpn, or operating system bug can still leave networking inconsistent. disconnect first. if that fails, close the app and wait about 30 seconds for its lease to expire. inspect for remaining `sing-box` processes and the `nightwire` or `utun188` interface before restarting. rebooting is the final recovery path; do not blindly delete interfaces belonging to another vpn.

the controller runs a proxy preflight before elevation. full-device success additionally requires the operating system to select nightwire's ipv4 and ipv6 routes, resolve a name through the system resolver, and complete a direct https request. udp is measured independently. a failed device check disconnects and reports the cause rather than displaying a false connected state.

vless uri imports support verified tls over websocket or tcp. reality, vision, custom insecure certificates, remote subscriptions, and traffic camouflage are outside this release. friends can use the same server with any compatible client and their individual standard vless invite.

## release plumbing

native ci jobs verify pinned dependencies, run real transport tests, and package a macos arm64 installer and a windows x64 installer. the workflow uploads build artifacts for each commit. the maintainer publishes a tested commit with an annotated tag and `gh release create`, attaching installers, server kit, checksums, and matching upstream source. no signing identity is invented by ci.
