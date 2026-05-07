import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5500);

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

createServer((request, response) => {
  const url = request.url || "/";
  const urlPath = url.split("?")[0];

  if (urlPath === "/api/files") {
    try {
      const files = readdirSync(root)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ name: f, size: statSync(join(root, f)).size }))
        .sort((a, b) => a.name.localeCompare(b.name));
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(files));
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Server error");
    }
    return;
  }

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
  console.log(`http://localhost:${port}`);
});
