$ErrorActionPreference = "Stop"
$out = Join-Path $PSScriptRoot "build"
New-Item -ItemType Directory -Force $out | Out-Null
javac --release 17 -d $out (Join-Path $PSScriptRoot "src/main/java/com/minedock/relay/Main.java")
jar --create --file (Join-Path $PSScriptRoot "minedock-relay.jar") --main-class com.minedock.relay.Main -C $out .
