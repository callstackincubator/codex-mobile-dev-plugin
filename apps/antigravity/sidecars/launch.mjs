import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || 0);
const TOKEN = process.env.ANTIGRAVITY_SIDECAR_TOKEN || "";
const PLUGIN_ROOT = process.env.PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(homedir(), "Library", "Caches", "mobile-dev");
const PANEL_STATE_FILE = join(CACHE_DIR, "antigravity-panel.json");
const STANDALONE_STATE_FILE = join(CACHE_DIR, "antigravity-standalone.json");

let standaloneChild = null;
let startingBackend = null;

function isPidAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readValidState(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.url === "string" && isPidAlive(parsed.pid)) {
      return parsed;
    }
  } catch {}
  return null;
}

async function getActiveBackend() {
  const mainState = await readValidState(PANEL_STATE_FILE);
  if (mainState) {
    if (standaloneChild && !standaloneChild.killed) {
      try { standaloneChild.kill("SIGTERM"); } catch {}
      standaloneChild = null;
    }
    return mainState;
  }
  return readValidState(STANDALONE_STATE_FILE);
}

async function ensureBackend() {
  const existing = await getActiveBackend();
  if (existing) return existing;

  if (startingBackend) return startingBackend;

  startingBackend = (async () => {
    try {
      if (!standaloneChild || standaloneChild.killed) {
        const launchScript = join(PLUGIN_ROOT, "scripts", "launch-node.sh");
        const serverScript = join(PLUGIN_ROOT, "dist", "server.mjs");
        standaloneChild = spawn("/bin/sh", [launchScript, serverScript], {
          env: {
            ...process.env,
            PLUGIN_ROOT,
            MOBILE_DEV_SIDECAR_STANDALONE: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        standaloneChild.stdout?.resume();
        standaloneChild.stderr?.resume();
        standaloneChild.on("exit", () => {
          standaloneChild = null;
        });
        // Send MCP initialize so the standalone stdio server stays open and starts its panel page.
        const initRequest = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "antigravity-sidecar", version: "1.0.0" },
          },
        });
        const initializedNotification = JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        standaloneChild.stdin?.write(`${initRequest}\n${initializedNotification}\n`);
      }

      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 200));
        const state = await getActiveBackend();
        if (state) return state;
      }
      return null;
    } finally {
      startingBackend = null;
    }
  })();

  return startingBackend;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      cookies[k] = decodeURIComponent(v);
    }
  }
  return cookies;
}

function verifyRequestToken(req, urlObj) {
  if (!TOKEN) return { valid: true, fromQuery: false };
  const queryToken = urlObj.searchParams.get("token");
  if (queryToken === TOKEN) return { valid: true, fromQuery: true };
  const headerToken = req.headers["x-sidecar-token"];
  if (headerToken === TOKEN) return { valid: true, fromQuery: false };
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.antigravity_sidecar_token === TOKEN) return { valid: true, fromQuery: false };
  return { valid: false, fromQuery: false };
}

function proxyHttpRequest(req, res, state, urlObj, setCookie) {
  const panelUrl = new URL(state.url);
  let targetPath = panelUrl.pathname;
  if (urlObj.pathname === "/mcp") {
    targetPath = `${panelUrl.pathname}mcp`;
  } else if (urlObj.pathname === "/context") {
    targetPath = `${panelUrl.pathname}context`;
  } else if (urlObj.pathname === "/" || urlObj.pathname === "/index.html") {
    targetPath = `${panelUrl.pathname}${panelUrl.search}`;
  } else {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const headers = { ...req.headers };
  headers.host = panelUrl.host;
  headers.origin = panelUrl.origin;
  delete headers.referer;

  const proxyReq = http.request(
    {
      hostname: panelUrl.hostname,
      port: Number(panelUrl.port),
      path: targetPath,
      method: req.method,
      headers,
    },
    proxyRes => {
      const resHeaders = { ...proxyRes.headers };
      if (typeof resHeaders["content-security-policy"] === "string") {
        resHeaders["content-security-policy"] = resHeaders["content-security-policy"].replace(/frame-ancestors\s+'none';?\s*/i, "");
      }
      if (setCookie && TOKEN) {
        resHeaders["set-cookie"] = `antigravity_sidecar_token=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax`;
      }
      res.writeHead(proxyRes.statusCode || 200, resHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", err => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end(`Mobile Dev sidecar proxy error: ${err.message}`);
  });

  req.pipe(proxyReq);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const auth = verifyRequestToken(req, urlObj);
    if (!auth.valid) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden: Invalid or missing Antigravity sidecar token.");
      return;
    }

    if (urlObj.pathname === "/api/status") {
      const state = await getActiveBackend();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({
        status: state ? "ok" : "starting",
        pid: state?.pid ?? null,
        updatedAt: state?.updatedAt ?? null,
      }));
      return;
    }

    const state = await ensureBackend();
    if (!state) {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Refresh": "2" });
      res.end("<!doctype html><html><body style='font-family:system-ui;padding:24px;color:#888'>Starting Mobile Dev backend...</body></html>");
      return;
    }

    proxyHttpRequest(req, res, state, urlObj, auth.fromQuery);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end(`Internal Server Error: ${err.message}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
  console.error(`[mobile-dev-sidecar] Listening on http://127.0.0.1:${actualPort}`);
  ensureBackend().catch(() => {});
});

function shutdown() {
  if (standaloneChild && !standaloneChild.killed) {
    try { standaloneChild.kill("SIGTERM"); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
