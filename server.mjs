import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5500);

const metaFiles = new Set(["files.json", "package.json", "package-lock.json"]);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function resolvePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = cleanPath === "/" ? "/viewer.html" : cleanPath;
  const resolved = normalize(join(root, requested));
  return resolved.startsWith(normalize(root)) ? resolved : null;
}

function jsonFiles() {
  return readdirSync(root)
    .filter((f) => f.endsWith(".json") && !metaFiles.has(f))
    .map((f) => ({ name: f, size: statSync(join(root, f)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

createServer((request, response) => {
  const url = request.url || "/";
  const urlPath = url.split("?")[0];

  // ── GET /api/files ──
  if (request.method === "GET" && urlPath === "/api/files") {
    try {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(jsonFiles()));
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Server error");
    }
    return;
  }

  // ── POST /api/upload ──
  if (request.method === "POST" && urlPath === "/api/upload") {
    const rawQuery = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    const params = new URLSearchParams(rawQuery);
    const filename = params.get("name");
    if (!filename || !filename.endsWith(".json")) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid filename");
      return;
    }
    const safeName = basename(filename);
    if (metaFiles.has(safeName)) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Reserved filename");
      return;
    }
    const chunks = [];
    request.on("data", (c) => chunks.push(c));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        JSON.parse(raw); // validate JSON
        writeFileSync(join(root, safeName), raw, "utf-8");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, name: safeName }));
      } catch (err) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // ── Static files ──
  const filePath = resolvePath(url);

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": types[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`别时容易见时难 → http://localhost:${port}`);
});
