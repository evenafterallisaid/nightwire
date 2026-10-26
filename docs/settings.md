# the knobs, without the mythology

open **settings** in the sidebar. appearance changes immediately. connection controls are locked while a tunnel is active; disconnect first. settings are saved to the application's user-data directory and survive updates.

| control                   | what it does                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| theme                     | midnight, paper, ember, abyss, moss, plum, ocean, rose, or follow the system appearance                                                                                  |
| speed units               | bytes per second or decimal bits per second; cumulative totals remain bytes                                                                                              |
| graph history             | 30 seconds, 1 minute, or 5 minutes of real samples from the current session                                                                                              |
| minimum tls               | require tls 1.2 or newer, or require tls 1.3; the server must support the chosen minimum                                                                                 |
| encrypted clienthello     | off, or require ech and tls 1.3; the endpoint must publish a supported ech key, and the connection fails if encrypted negotiation cannot complete                        |
| encrypted dns             | cloudflare, quad9, or google dns over https through the gateway                                                                                                          |
| internet address families | automatic tests ipv6 internet access through the gateway; ipv4-only suppresses unusable aaaa/https hints; requiring dual stack refuses to connect if the ipv6 test fails |
| server address preference | prefer ipv4, prefer ipv6 with fallback, or preserve operating system address order                                                                                       |
| connection timeout        | the core's outbound dial timeout: 10, 20, or 30 seconds                                                                                                                  |
| tunnel mtu                | 1280, 1400, or 1500; lower values can help with packet-size issues                                                                                                       |
| network stack             | mixed, gvisor userspace, or the system stack; mixed is the tested default                                                                                                |
| udp packet format         | xudp or packetaddr; the server must understand the selected format                                                                                                       |

certificate verification stays enabled. a tls-version setting changes the handshake requirement, not the underlying vless protocol or a separate payload cipher. this gateway uses vless over verified tls and websocket; it does not gain a new server protocol because a desktop preference changed.

quad9's default service can block malicious domains. providers' privacy and filtering policies differ: see [quad9's service details](https://docs.quad9.net/services/), [google's dns-over-https documentation](https://developers.google.com/speed/public-dns/docs/doh), and [cloudflare's resolver documentation](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/).

the endpoint's initial hostname lookup uses the operating system before routing starts. normal intercepted dns goes through the selected provider. macos temporarily selects the tun resolver while connected and restores its ordinary resolver on disconnect. the gateway independently resolves proxy requests that carry hostnames using its own resolver. changing the desktop preference does not rewrite the gateway's configuration.

when ech is required, only the endpoint's https dns record is fetched directly from the selected encrypted dns provider to discover its key before the proxy is available. this exception precedes ipv4-only https-hint suppression; other intercepted dns still travels through the gateway. certificate verification and the requested endpoint name stay intact. there is no automatic retry with a visible server name. the initial operating-system address lookup, destination ip, and traffic patterns remain visible to the surrounding network; ech does not guarantee access through a filter. [cloudflare's ech documentation](https://developers.cloudflare.com/ssl/edge-certificates/ech/) explains its server support and visible outer name.

the traffic view has a shared speed scale, elapsed-time labels, and separate solid download and dashed upload lines. hover to inspect a sample, or focus the graph and use the left/right arrow keys. the scale adapts to the visible window; an empty window has no invented activity. samples reset on a new connection and stay visible until the next session or app restart. counters exclude outer tls/websocket overhead.

if an advanced setting breaks connectivity, disconnect, open settings, and reset defaults. a failed device route check stops the tunnel rather than claiming a connection.

auto detection checks an actual verified ipv6 tls connection through the proxy, not merely whether a local ipv6 route exists. ipv6 is still captured when the gateway only has ipv4 internet access. explicit ipv6-only destinations cannot be reached through an ipv4-only gateway. browsers with their own encrypted dns may bypass the local answer policy; their cached address answers may need to expire or be refreshed after reconnecting.
