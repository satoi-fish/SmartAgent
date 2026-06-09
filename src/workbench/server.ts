import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApprovalStatus, ProviderName, TeamMode } from "../types/index.js";
import {
  createInteractivePlan,
  createInteractiveSchedule,
  enqueueInteractiveTask,
  executeInteractiveApproval,
  loadOperationsState,
  runInteractiveTask,
  tickInteractiveScheduler,
  tickInteractiveWorker,
  updateInteractiveApproval,
} from "./controlPlane.js";
import {
  listWorkbenchRuns,
  loadDefaultWorkbenchRun,
  loadWorkbenchDebugPayload,
  loadWorkbenchMeta,
  loadWorkbenchRun,
} from "./runStore.js";

function parseArgs(argv: string[]): { host: string; port: number } {
  const args = {
    host: process.env.WORKBENCH_HOST ?? "127.0.0.1",
    port: Number(process.env.WORKBENCH_PORT ?? "4173"),
  };

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

async function loadStaticPage(fileName: string): Promise<string> {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  return await readFile(resolve(currentDir, "static", fileName), "utf8");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

function requireMutationAuth(request: IncomingMessage, response: ServerResponse): boolean {
  const expectedToken = process.env.WORKBENCH_API_TOKEN?.trim();
  if (!expectedToken) {
    return true;
  }

  const authHeader = request.headers.authorization ?? "";
  const actualToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (actualToken === expectedToken) {
    return true;
  }

  sendJson(response, 401, {
    error: "Unauthorized. Provide a Bearer token that matches WORKBENCH_API_TOKEN.",
  });
  return false;
}

function parseProviderName(raw: string | undefined): ProviderName {
  switch (raw) {
    case "anthropic":
    case "google":
    case "deepseek":
    case "azure-openai":
    case "openai":
      return raw;
    default:
      return "openai";
  }
}

function parseApprovalStatus(raw: string | undefined): ApprovalStatus {
  switch (raw) {
    case "approved":
    case "rejected":
    case "pending":
      return raw;
    default:
      throw new Error("status must be one of approved, rejected, or pending.");
  }
}

function parseTeamMode(raw: string | undefined): TeamMode | undefined {
  switch (raw) {
    case undefined:
    case "":
      return undefined;
    case "single":
    case "planner_reviewer":
      return raw;
    default:
      throw new Error("teamMode must be one of single or planner_reviewer.");
  }
}

const { host, port } = parseArgs(process.argv.slice(2));
const observabilityHtml = await loadStaticPage("index.html");
const consoleHtml = await loadStaticPage("console.html");

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, {
        ok: true,
        service: "smartagent-workbench",
        time: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(consoleHtml);
      return;
    }

    if (request.method === "GET" && url.pathname === "/observability") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(observabilityHtml);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/workbench/runs") {
      const runs = await listWorkbenchRuns();
      sendJson(response, 200, { runs });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/workbench/meta") {
      const meta = await loadWorkbenchMeta();
      sendJson(response, 200, meta);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/workbench/default") {
      const run = await loadDefaultWorkbenchRun();
      sendJson(response, 200, run);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/workbench/runs/")) {
      const suffix = decodeURIComponent(url.pathname.replace("/api/workbench/runs/", ""));

      if (suffix.endsWith("/events")) {
        const id = suffix.slice(0, -"/events".length);
        const payload = await loadWorkbenchDebugPayload(id);
        if (!payload) {
          sendJson(response, 404, { error: `Run "${id}" was not found.` });
          return;
        }

        sendJson(response, 200, payload);
        return;
      }

      const run = await loadWorkbenchRun(suffix);
      if (!run) {
        sendJson(response, 404, { error: `Run "${suffix}" was not found.` });
        return;
      }

      sendJson(response, 200, run);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/control/state") {
      sendJson(response, 200, await loadOperationsState());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/control/config") {
      sendJson(response, 200, {
        authRequired: Boolean(process.env.WORKBENCH_API_TOKEN?.trim()),
        host,
        port,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/run") {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      const body = await readJsonBody<{
        prompt?: string;
        providerName?: string;
        mode?: "default" | "plan" | "auto";
        teamMode?: TeamMode;
      }>(request);
      if (!body.prompt?.trim()) {
        sendJson(response, 400, { error: "prompt is required." });
        return;
      }

      const result = await runInteractiveTask({
        prompt: body.prompt.trim(),
        providerName: parseProviderName(body.providerName),
        mode: body.mode,
        teamMode: parseTeamMode(body.teamMode),
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/plan") {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      const body = await readJsonBody<{ prompt?: string; providerName?: string }>(request);
      if (!body.prompt?.trim()) {
        sendJson(response, 400, { error: "prompt is required." });
        return;
      }

      sendJson(
        response,
        200,
        await createInteractivePlan({
          prompt: body.prompt.trim(),
          providerName: parseProviderName(body.providerName),
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/control/approvals/")) {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      const approvalId = decodeURIComponent(url.pathname.replace("/api/control/approvals/", ""));
      const body = await readJsonBody<{ status?: string }>(request);
      const updated = await updateInteractiveApproval({
        approvalId,
        status: parseApprovalStatus(body.status),
      });

      if (!updated) {
        sendJson(response, 404, { error: `Approval "${approvalId}" was not found.` });
        return;
      }

      sendJson(response, 200, updated);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/execute-approved") {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      const body = await readJsonBody<{ approvalId?: string; providerName?: string }>(request);
      if (!body.approvalId?.trim()) {
        sendJson(response, 400, { error: "approvalId is required." });
        return;
      }

      const result = await executeInteractiveApproval({
        approvalId: body.approvalId.trim(),
        providerName: parseProviderName(body.providerName),
      });
      sendJson(response, 200, {
        approvalId: body.approvalId.trim(),
        runId: result.runId,
        logPath: result.logPath,
        summary: result.structuredAnswer.summary,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/tasks") {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      const body = await readJsonBody<{ prompt?: string; approvalId?: string }>(request);
      if (!body.prompt?.trim()) {
        sendJson(response, 400, { error: "prompt is required." });
        return;
      }

      sendJson(
        response,
        200,
        await enqueueInteractiveTask({
          prompt: body.prompt.trim(),
          approvalId: body.approvalId?.trim() || undefined,
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/worker/tick") {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      const body = await readJsonBody<{ providerName?: string }>(request);
      sendJson(
        response,
        200,
        await tickInteractiveWorker({
          providerName: parseProviderName(body.providerName),
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/schedules") {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      const body = await readJsonBody<{
        prompt?: string;
        kind?: "once" | "interval";
        runAt?: string;
        everyMinutes?: number;
        approvalId?: string;
      }>(request);
      if (!body.prompt?.trim()) {
        sendJson(response, 400, { error: "prompt is required." });
        return;
      }
      if (body.kind !== "once" && body.kind !== "interval") {
        sendJson(response, 400, { error: "kind must be once or interval." });
        return;
      }
      if (body.kind === "once" && !body.runAt) {
        sendJson(response, 400, { error: "runAt is required for one-time schedules." });
        return;
      }
      if (body.kind === "interval" && (!Number.isFinite(body.everyMinutes) || (body.everyMinutes ?? 0) <= 0)) {
        sendJson(response, 400, { error: "everyMinutes must be a positive number for interval schedules." });
        return;
      }

      sendJson(
        response,
        200,
        await createInteractiveSchedule({
          prompt: body.prompt.trim(),
          kind: body.kind,
          runAt: body.runAt,
          everyMinutes: body.everyMinutes,
          approvalId: body.approvalId?.trim() || undefined,
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/scheduler/tick") {
      if (!requireMutationAuth(request, response)) {
        return;
      }

      sendJson(response, 200, {
        results: await tickInteractiveScheduler(),
      });
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`SmartAgent Workbench running at http://${host}:${port}\n`);
});
