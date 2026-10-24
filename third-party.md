# the people whose code is doing the heavy lifting

nightwire's original application and server tooling use the mit license.

- sing-box 1.14.4 provides the proxy protocol and system-wide network stack. it uses the gnu general public license, version 3 or later. its unmodified license is included beside the executable. the matching source and build files are at [the upstream release tag](https://github.com/SagerNet/sing-box/tree/v1.14.4). the release also provides a source archive. upstream source, module manifests, and upstream build instructions identify the corresponding dependency sources.
- electron provides the desktop runtime. its mit license and chromium's third-party notices are included with the application runtime. [electron source](https://github.com/electron/electron).
- the windows package includes the official, unmodified wintun 0.14.1 library from [wintun.net](https://www.wintun.net/). its prebuilt binary license is included beside the library. nightwire uses the published api; it does not modify the driver.
- the optional windows server installer downloads winsw 2.12.0 from its official release. winsw uses the mit license. [source and license](https://github.com/winsw/winsw/tree/v2.12.0).
- resvg and resedit are build tools, not services running inside the tunnel. their versions and licenses are recorded in package-lock.json.

upstream legal notices retain their original capitalization. our coffee has no jurisdiction over other people's licenses.
