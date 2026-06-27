package com.minedock.relay;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.*;

public final class Main {
    private static final ExecutorService TASKS = Executors.newCachedThreadPool();
    private static final ConcurrentMap<String, CompletableFuture<Socket>> PENDING = new ConcurrentHashMap<>();
    private static final ConcurrentMap<Integer, ServerSocket> PUBLIC_LISTENERS = new ConcurrentHashMap<>();
    private static String token;

    public static void main(String[] args) throws Exception {
        String bind = env("MINEDOCK_BIND", "0.0.0.0:7000");
        token = System.getenv("MINEDOCK_TOKEN");
        if (token == null || token.length() < 32) {
            throw new IllegalArgumentException("MINEDOCK_TOKEN must contain at least 32 characters");
        }
        int separator = bind.lastIndexOf(':');
        String host = bind.substring(0, separator);
        int port = Integer.parseInt(bind.substring(separator + 1));
        try (ServerSocket listener = new ServerSocket()) {
            listener.bind(new InetSocketAddress(host, port));
            System.out.println("MineDock relay listening on " + bind);
            while (true) {
                Socket socket = listener.accept();
                TASKS.execute(() -> handle(socket));
            }
        }
    }

    private static void handle(Socket socket) {
        boolean handedOff = false;
        try {
            socket.setTcpNoDelay(true);
            String nonce = UUID.randomUUID().toString().replace("-", "");
            writeLine(socket, nonce);
            String line = readLine(socket);
            String[] parts = line.split(" ");
            if (parts.length < 3) throw new IOException("invalid handshake");
            String command = String.join(" ", java.util.Arrays.copyOf(parts, parts.length - 1));
            if (!MessageDigest.isEqual(signature(nonce + ":" + command), HexFormat.of().parseHex(parts[parts.length - 1]))) {
                throw new IOException("authentication failed");
            }
            if ("CONTROL".equals(parts[0]) && parts.length == 3) {
                int port = validPort(parts[1]);
                writeLine(socket, "OK");
                expose(port, socket);
            } else if ("DATA".equals(parts[0]) && parts.length == 4) {
                CompletableFuture<Socket> pending = PENDING.remove(parts[2]);
                if (pending == null) throw new IOException("unknown session");
                writeLine(socket, "OK");
                handedOff = pending.complete(socket);
            } else {
                throw new IOException("invalid command");
            }
        } catch (Exception error) {
            System.err.println(socket.getRemoteSocketAddress() + ": " + error.getMessage());
        } finally {
            if (!handedOff) close(socket);
        }
    }

    private static void expose(int port, Socket control) throws IOException {
        ServerSocket publicListener = new ServerSocket();
        publicListener.setReuseAddress(true);
        synchronized (PUBLIC_LISTENERS) {
            ServerSocket current = PUBLIC_LISTENERS.get(port);
            if (current != null && !current.isClosed()) {
                publicListener.close();
                throw new BindException("Public port " + port + " already has an active tunnel");
            }
            publicListener.bind(new InetSocketAddress("0.0.0.0", port));
            PUBLIC_LISTENERS.put(port, publicListener);
        }
        try (publicListener) {
            System.out.println("Public port " + port + " connected");
            TASKS.execute(() -> {
                try {
                    while (control.getInputStream().read() != -1) {}
                } catch (IOException ignored) {
                } finally {
                    try { publicListener.close(); } catch (IOException ignored) {}
                }
            });
            while (!control.isClosed()) {
                Socket player;
                try {
                    player = publicListener.accept();
                } catch (SocketException error) {
                    if (control.isClosed() || publicListener.isClosed()) break;
                    throw error;
                }
                player.setTcpNoDelay(true);
                String session = UUID.randomUUID().toString().replace("-", "");
                CompletableFuture<Socket> tunnel = new CompletableFuture<>();
                PENDING.put(session, tunnel);
                writeLine(control, "OPEN " + session);
                TASKS.execute(() -> pair(session, player, tunnel));
            }
        } finally {
            PUBLIC_LISTENERS.remove(port, publicListener);
            System.out.println("Public port " + port + " disconnected");
        }
    }

    private static void pair(String session, Socket player, CompletableFuture<Socket> future) {
        long started = System.nanoTime();
        try (player) {
            Socket tunnel = future.get(3, TimeUnit.SECONDS);
            try (tunnel) {
                tunnel.setTcpNoDelay(true);
                long pairingMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
                if (pairingMs > 500) System.err.println("Slow tunnel pairing: " + pairingMs + "ms");
                Future<?> upstream = TASKS.submit(() -> copy(player, tunnel));
                copy(tunnel, player);
                upstream.get();
            }
        } catch (TimeoutException error) {
            System.err.println("Tunnel pairing timed out for session " + session);
        } catch (Exception error) {
            System.err.println("Tunnel session " + session + " failed: " + error.getMessage());
        } finally {
            PENDING.remove(session);
        }
    }

    private static void copy(Socket source, Socket target) {
        try {
            source.getInputStream().transferTo(target.getOutputStream());
            target.shutdownOutput();
        } catch (IOException ignored) {
        }
    }

    private static byte[] signature(String message) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(token.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
    }

    private static String readLine(Socket socket) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        InputStream input = socket.getInputStream();
        for (int value; (value = input.read()) != -1;) {
            if (value == '\n') return bytes.toString(StandardCharsets.UTF_8).trim();
            if (bytes.size() >= 1024) throw new IOException("handshake too long");
            bytes.write(value);
        }
        throw new EOFException("connection closed");
    }

    private static void writeLine(Socket socket, String value) throws IOException {
        socket.getOutputStream().write((value + "\n").getBytes(StandardCharsets.UTF_8));
        socket.getOutputStream().flush();
    }

    private static int validPort(String value) {
        int port = Integer.parseInt(value);
        if (port < 1 || port > 65535) throw new IllegalArgumentException("invalid port");
        return port;
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static void close(Socket socket) {
        try { socket.close(); } catch (IOException ignored) {}
    }
}
