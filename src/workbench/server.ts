import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { listWorkbenchRuns, loadDefaultWorkbenchRun, loadWorkbenchMeta, loadWorkbenchRun } from "./runStore.js";

function parseArgs(argv: string[]): { host: string; port: number } {
  const args = { host: "127.0.0.1", port: 4173 };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    const next = argv[index + 1];

    if ((part === "--host" || part === "-H") && next) {
      args.host = next;
      index += 1;
      continue;
    }

    if ((part === "--port" || part === "-p") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.port = parsed;
      }
      index += 1;
    }
  }

  return args;
}

async function loadIndexHtml(): Promise<string> {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  return await readFile(resolve(currentDir, "static", "index.html"), "utf8");
}

const { host, port } = parseArgs(process.argv.slice(2));
const indexHtml = await loadIndexHtml();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(indexHtml);
    return;
  }

  if (url.pathname === "/api/workbench/runs") {
    const runs = await listWorkbenchRuns();
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ runs }, null, 2));
    return;
  }

  if (url.pathname === "/api/workbench/meta") {
    const meta = await loadWorkbenchMeta();
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(meta, null, 2));
    return;
  }

  if (url.pathname === "/api/workbench/default") {
    const run = await loadDefaultWorkbenchRun();
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(run, null, 2));
    return;
  }

  if (url.pathname.startsWith("/api/workbench/runs/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/workbench/runs/", ""));
    const run = await loadWorkbenchRun(id);

    if (!run) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: `Run "${id}" was not found.` }, null, 2));
      return;
    }

    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(run, null, 2));
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Not found." }, null, 2));
});

server.listen(port, host, () => {
  process.stdout.write(`SmartAgent Workbench running at http://${host}:${port}\n`);
});
