#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
mkdir -p build
javac --release 17 -d build src/main/java/com/minedock/relay/Main.java
jar --create --file minedock-relay.jar --main-class com.minedock.relay.Main -C build .
