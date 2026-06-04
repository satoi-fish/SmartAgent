import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWorkbenchRunView } from "./buildRunView.js";
import { buildDemoPipelineRun } from "./demoRun.js";
import type { PersistedRunLog, WorkbenchRunListItem, WorkbenchRunView } from "./types.js";

function getLogDir(logDir?: string): string {
  return logDir ?? resolve(process.cwd(), ".agent-runs");
}

async function readPersistedRunLog(filePath: string): Promise<PersistedRunLog> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as PersistedRunLog;
}

export async function listPersistedRunLogs(logDir?: string): Promise<PersistedRunLog[]> {
  const dir = getLogDir(logDir);
  let entries: string[] = [];

  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const runFiles = entries.filter((entry) => entry.endsWith(".json")).sort().reverse();
  const runs: PersistedRunLog[] = [];

  for (const file of runFiles) {
    try {
      runs.push(await readPersistedRunLog(resolve(dir, file)));
    } catch {
      // Ignore malformed run logs so the workbench can still boot.
    }
  }

  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function listWorkbenchRuns(logDir?: string): Promise<WorkbenchRunListItem[]> {
  const persistedRuns = await listPersistedRunLogs(logDir);
  const realRuns = persistedRuns.map((run) => {
    const view = buildWorkbenchRunView(run);
    return {
      id: view.id,
      label: view.label,
      source: view.source,
      status: view.status,
      startedAt: view.startedAt,
      provider: view.provider,
    } satisfies WorkbenchRunListItem;
  });

  return [
    buildDemoRunListItem(),
    ...realRuns,
  ];
}

function buildDemoRunListItem(): WorkbenchRunListItem {
  const demo = buildDemoPipelineRun();
  return {
    id: demo.id,
    label: demo.label,
    source: demo.source,
    status: demo.status,
    startedAt: demo.startedAt,
    provider: demo.provider,
  };
}

export async function loadWorkbenchRun(id: string, logDir?: string): Promise<WorkbenchRunView | null> {
  if (id === "demo-pipeline") {
    return buildDemoPipelineRun();
  }

  const persistedRuns = await listPersistedRunLogs(logDir);
  const match = persistedRuns.find((run) => run.runId === id);
  if (!match) {
    return null;
  }

  return buildWorkbenchRunView(match);
}

export async function loadDefaultWorkbenchRun(logDir?: string): Promise<WorkbenchRunView> {
  const persistedRuns = await listPersistedRunLogs(logDir);
  if (persistedRuns.length > 0) {
    return buildWorkbenchRunView(persistedRuns[0]);
  }

  return buildDemoPipelineRun();
}
