# MineDock Java Relay

Requires Java 17 or newer.

## Build

Windows:

```powershell
.\tunnel-relay\build.ps1
```

Linux/macOS:

```sh
chmod +x tunnel-relay/build.sh
./tunnel-relay/build.sh
```

Result: `tunnel-relay/minedock-relay.jar`.

## Run on public machine

Linux/macOS:

```sh
MINEDOCK_BIND=0.0.0.0:7000 \
MINEDOCK_TOKEN='replace-with-32-or-more-random-characters' \
java -jar minedock-relay.jar
```

Windows PowerShell:

```powershell
$env:MINEDOCK_BIND = "0.0.0.0:7000"
$env:MINEDOCK_TOKEN = "replace-with-32-or-more-random-characters"
java -jar minedock-relay.jar
```

Open TCP port `7000` plus every Minecraft server port in firewall. Enter
`public-host:7000` and same token under MineDock Settings, then enable tunnel.
Players connect to `public-host:<server-port>`.

Relay uses only Java standard library. Every control and data connection uses
nonce-based HMAC-SHA256 authentication. Token never travels over network.
Minecraft traffic stays protocol-native; use VPN or TLS proxy when payload
encryption is required.
