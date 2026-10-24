# where the secrets sleep

nightwire has no analytics, telemetry endpoint, subscription backend, or automatic update request. explicit connection checks contact discord.com, example.com, and cloudflare's public dns service. the gateway also uses cloudflare's public dns-over-https resolver.

the theme choice stays in local storage. live traffic totals stay in memory; a protected local core api supplies only counters to the window. the interface does not display the core api's connection list or destination metadata.

saved invites are encrypted with electron safestorage: the macos keychain or windows account's data protection. they stay in the application's user-data directory. encryption protects storage, not an already compromised account. exporting an invite deliberately creates a plaintext credential file.

the renderer receives profile names and server addresses, not saved login ids. session manifests and core configurations must contain the login while the backend runs; they live in a private session directory. on macos those files are mode 0600 under a mode 0700 directory. on windows they inherit the logged-in account's profile-directory permissions. this is not protection against administrators. session control uses a fresh 256-bit bearer token on loopback and rejects unauthenticated requests.

logs redact login ids and session tokens. they can still contain server names, destination addresses, and diagnostic errors. avoid publishing raw logs. the home gateway's warning logs are rotated; the service operator can inspect proxy traffic and destinations. cloudflare handles the outer tls connection, so do not treat this setup as a tunnel opaque to cloudflare. websites see the gateway's public exit address.

revocation happens at the gateway. deleting an invite from one desktop does not revoke copies of it. use the server admin command when access needs to end.
