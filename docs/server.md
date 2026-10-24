# the home gateway

use an administrator powershell on a windows x64 machine you control. install node 24 or newer from its official distributor. download the release's server kit, extract it, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\server\install.ps1 -Hostname home.example -OwnerName owner
```

replace `home.example` with your own dedicated hostname. the one-command execution-policy setting applies only to this installer process. it does not change the machine's saved policy.

the installer verifies fixed upstream sing-box and winsw hashes, installs into `C:\ProgramData\nightwire`, and registers the `nightwire` windows service. the service runs as localservice, starts automatically, and restarts after a failure. no inbound firewall rule or router port forward is created. its listener is `127.0.0.1:2087`. the service cannot read arbitrary user profiles; its directory and logs have restricted access.

## publish the hostname

in your existing cloudflare tunnel, add a published application hostname:

| setting  | value                           |
| -------- | ------------------------------- |
| hostname | your dedicated gateway hostname |
| service  | `http://127.0.0.1:2087`         |
| path     | leave blank                     |

use a tunnel connector running on the gateway machine. keep unrelated ssh/application routes unchanged. cloudflare must allow websocket upgrades and issue a valid public certificate for the hostname. an interactive access login page in front of this hostname is incompatible with this client; authentication is the separate vless login inside the connection. an unknown websocket path or login cannot use the gateway, but the hostname is publicly reachable.

the service binds loopback because cloudflared is on the same machine. do not expose the plaintext origin listener on the lan or internet. the server's destination restrictions are enforced after resolving domain names, before outbound connections.

## invites, one human at a time

run from an administrator powershell:

```powershell
cd C:\ProgramData\nightwire
node server/admin.mjs list
node server/admin.mjs add --name friend
node server/admin.mjs export --name owner
node server/admin.mjs revoke --name friend
node server/admin.mjs apply
```

`add` writes a `.nightwire` invite and a standard vless link in `private\invites`. output prints filenames, not credentials. give each friend only their own file through a channel you trust. an invite is a bearer credential: anyone holding it can use that login. revoking restarts the gateway, which briefly disconnects all users. old exported files remain on disk but stop authenticating. names are never reused; pick a new one for a replacement invite.

`apply` validates and reapplies the current user database after a tooling update. configuration is validated with the actual core before replacement. `config.json.previous` preserves the preceding generated configuration. protect it like a credential file too. if the restart fails, the command reports it; check the service rather than assuming access changed.

the last active login cannot be revoked accidentally. to close all access:

```powershell
Stop-Service nightwire
Set-Service nightwire -StartupType Disabled
```

remove its published cloudflare hostname too if you no longer want a public endpoint. removing nightwire must not remove your unrelated ssh tunnel or change your login password.

## keep it awake, keep it locked

locking windows does not stop this service. configure plugged-in sleep and lid behavior deliberately; allow the screen to turn off and require authentication to unlock. a laptop running continuously needs adequate ventilation. battery sleep can remain enabled so an unplugged machine does not drain itself flat.

## maintain it

check `Get-Service nightwire` and `C:\ProgramData\nightwire\logs` for failures. default warning logs may contain destination addresses and error details. do not post raw logs or the private directory publicly.

to update, stop the service first, preserve the restricted private directory, rerun the installer from the new server kit, then run `node server/admin.mjs apply`. existing logins are retained. the installer refuses to create a second user database over an existing one. back up private state securely before changing it.
