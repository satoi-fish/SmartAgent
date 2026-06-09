import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";

import { ShellAuditStore } from "./shellAuditStore.js";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".agent-runs",
  ".agent-cache.json",
  ".agent-session.json",
  ".agent-memory.json",
  ".agent-idempotency.json",
  ".agent-tasks.json",
  ".agent-approvals.json",
  ".agent-schedules.json",
  ".agent-permissions.json",
  ".agent-shell-audit.jsonl",
  ".agent-browser-audit.jsonl",
  ".agent-browser-shots",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".env",
  ".css",
  ".html",
  ".xml",
  ".sh",
]);

type PackageManager = "npm" | "pnpm" | "yarn";

export interface WorkspaceCommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export interface WorkspaceFileWriteResult {
  path: string;
  mode: "overwrite" | "append";
  bytesWritten: number;
  created: boolean;
}

export interface WorkspacePatchResult {
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  applied: boolean;
  validatedPaths: string[];
}

export class WorkspaceTools {
  private readonly rootDir: string;
  private readonly localWebAllowlist: Set<string>;

  constructor(
    rootDir = process.env.AGENT_WORKSPACE_ROOT
      ? resolve(process.env.AGENT_WORKSPACE_ROOT)
      : process.cwd(),
    private readonly auditStore = new ShellAuditStore(),
  ) {
    this.rootDir = rootDir;
    this.localWebAllowlist = new Set(
      (process.env.AGENT_LOCAL_WEB_ALLOWLIST ?? "localhost,127.0.0.1,::1")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  async listFiles(args: {
    pathPrefix?: string;
    query?: string;
    maxResults: number;
  }): Promise<string[]> {
    const startDir = this.resolveWithinRoot(args.pathPrefix ?? ".");
    const results: string[] = [];
    const query = args.query?.toLowerCase().trim();

    await this.walk(startDir, results, {
      maxResults: args.maxResults,
      query,
    });

    return results;
  }

  async readTextFile(args: {
    path: string;
    startLine: number;
    maxLines: number;
    maxChars: number;
  }): Promise<{
    path: string;
    content: string;
    startLine: number;
    endLine: number;
    truncated: boolean;
  }> {
    const absolutePath = this.resolveWithinRoot(args.path);
    const extension = extname(absolutePath).toLowerCase();
    if (extension && !TEXT_EXTENSIONS.has(extension)) {
      throw new Error(`File type "${extension}" is not enabled for direct text reading.`);
    }

    const raw = await readFile(absolutePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const startIndex = Math.max(0, args.startLine - 1);
    const endIndex = Math.min(lines.length, startIndex + args.maxLines);
    const slice = lines.slice(startIndex, endIndex).join("\n");
    const truncated = slice.length > args.maxChars;
    const content = truncated ? `${slice.slice(0, args.maxChars)}...` : slice;

    return {
      path: relative(this.rootDir, absolutePath) || ".",
      content,
      startLine: startIndex + 1,
      endLine: endIndex,
      truncated,
    };
  }

  async writeTextFile(args: {
    path: string;
    content: string;
    mode: "overwrite" | "append";
  }): Promise<WorkspaceFileWriteResult> {
    const absolutePath = this.resolveWithinRoot(args.path);
    const existed = await fileExists(absolutePath);
    await mkdir(dirname(absolutePath), { recursive: true });

    if (args.mode === "append") {
      const prefix = existed ? "" : "";
      await writeFile(absolutePath, `${prefix}${args.content}`, {
        encoding: "utf8",
        flag: existed ? "a" : "w",
      });
    } else {
      await writeFile(absolutePath, args.content, "utf8");
    }

    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      toolName: "write_workspace_file",
      command: args.mode === "append" ? "append_file" : "write_file",
      args: [relative(this.rootDir, absolutePath)],
      cwd: this.rootDir,
      exitCode: 0,
      durationMs: 0,
      stdoutPreview: args.content.slice(0, 200),
      stderrPreview: "",
    });

    return {
      path: relative(this.rootDir, absolutePath),
      mode: args.mode,
      bytesWritten: Buffer.byteLength(args.content, "utf8"),
      created: !existed,
    };
  }

  async runCommand(args: {
    action: "pwd" | "ls" | "rg" | "git_status" | "git_diff";
    commandArgs: string[];
    cwd?: string;
    timeoutMs: number;
    maxOutputChars: number;
  }): Promise<WorkspaceCommandResult> {
    const cwd = this.resolveWithinRoot(args.cwd ?? ".");
    const mapped = this.mapCommand(args.action, args.commandArgs);
    const startedAt = Date.now();
    const builtinResult = await this.runBuiltinCommand({
      action: args.action,
      commandArgs: args.commandArgs,
      cwd,
      maxOutputChars: args.maxOutputChars,
    });
    const result =
      builtinResult ??
      (await execFileSafe({
        command: mapped.command,
        args: mapped.args,
        cwd,
        timeoutMs: args.timeoutMs,
        maxOutputChars: args.maxOutputChars,
      }));
    const auditedCommand = builtinResult
      ? {
          command: builtinResult.command,
          args: builtinResult.args,
        }
      : mapped;

    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      toolName: "run_workspace_command",
      command: auditedCommand.command,
      args: auditedCommand.args,
      cwd,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
      stdoutPreview: result.stdout.slice(0, 400),
      stderrPreview: result.stderr.slice(0, 400),
    });

    return result;
  }

  async installDependencies(args: {
    cwd?: string;
    packageManager?: PackageManager | "auto";
    frozenLockfile?: boolean;
    timeoutMs: number;
    maxOutputChars: number;
  }): Promise<WorkspaceCommandResult & { packageManager: PackageManager }> {
    const cwd = this.resolveWithinRoot(args.cwd ?? ".");
    const packageManager = await this.detectPackageManager(cwd, args.packageManager ?? "auto");
    const command = this.packageManagerExecutable(packageManager);
    const installArgs =
      packageManager === "npm"
        ? args.frozenLockfile
          ? ["ci"]
          : ["install"]
        : packageManager === "pnpm"
          ? ["install", ...(args.frozenLockfile ? ["--frozen-lockfile"] : [])]
          : ["install", ...(args.frozenLockfile ? ["--immutable"] : [])];
    const result = await execFileSafe({
      command,
      args: installArgs,
      cwd,
      timeoutMs: args.timeoutMs,
      maxOutputChars: args.maxOutputChars,
    });

    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      toolName: "install_workspace_dependencies",
      command,
      args: installArgs,
      cwd,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutPreview: result.stdout.slice(0, 400),
      stderrPreview: result.stderr.slice(0, 400),
    });

    return {
      ...result,
      packageManager,
    };
  }

  async runTests(args: {
    cwd?: string;
    packageManager?: PackageManager | "auto";
    script?: string;
    timeoutMs: number;
    maxOutputChars: number;
  }): Promise<WorkspaceCommandResult & { packageManager: PackageManager; script: string }> {
    const cwd = this.resolveWithinRoot(args.cwd ?? ".");
    const packageManager = await this.detectPackageManager(cwd, args.packageManager ?? "auto");
    const pkg = await this.readPackageJson(cwd);
    const script =
      args.script && args.script !== "auto"
        ? args.script
        : this.detectTestScript(pkg?.scripts ?? {});
    const command = this.packageManagerExecutable(packageManager);
    const scriptArgs =
      packageManager === "yarn" ? [script] : ["run", script];
    const result = await execFileSafe({
      command,
      args: scriptArgs,
      cwd,
      timeoutMs: args.timeoutMs,
      maxOutputChars: args.maxOutputChars,
    });

    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      toolName: "run_workspace_tests",
      command,
      args: scriptArgs,
      cwd,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutPreview: result.stdout.slice(0, 400),
      stderrPreview: result.stderr.slice(0, 400),
    });

    return {
      ...result,
      packageManager,
      script,
    };
  }

  async applyPatch(args: {
    patch: string;
    cwd?: string;
    timeoutMs: number;
    maxOutputChars: number;
    checkOnly?: boolean;
  }): Promise<WorkspacePatchResult> {
    const cwd = this.resolveWithinRoot(args.cwd ?? ".");
    const validatedPaths = this.extractAndValidatePatchPaths(args.patch);
    const checkArgs = ["apply", "--check", "--recount", "--whitespace=nowarn", "-"];
    const checkResult = await execFileSafe({
      command: this.gitExecutable(),
      args: checkArgs,
      cwd,
      timeoutMs: args.timeoutMs,
      maxOutputChars: args.maxOutputChars,
      stdinText: args.patch,
    });

    if (checkResult.exitCode !== 0 || args.checkOnly) {
      await this.auditStore.append({
        timestamp: new Date().toISOString(),
        toolName: "apply_workspace_patch",
        command: this.gitExecutable(),
        args: checkArgs,
        cwd,
        exitCode: checkResult.exitCode,
        durationMs: checkResult.durationMs,
        stdoutPreview: checkResult.stdout.slice(0, 400),
        stderrPreview: checkResult.stderr.slice(0, 400),
      });

      return {
        cwd,
        exitCode: checkResult.exitCode,
        stdout: checkResult.stdout,
        stderr: checkResult.stderr,
        durationMs: checkResult.durationMs,
        applied: false,
        validatedPaths,
      };
    }

    const applyArgs = ["apply", "--recount", "--whitespace=nowarn", "-"];
    const applyResult = await execFileSafe({
      command: this.gitExecutable(),
      args: applyArgs,
      cwd,
      timeoutMs: args.timeoutMs,
      maxOutputChars: args.maxOutputChars,
      stdinText: args.patch,
    });

    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      toolName: "apply_workspace_patch",
      command: this.gitExecutable(),
      args: applyArgs,
      cwd,
      exitCode: applyResult.exitCode,
      durationMs: applyResult.durationMs,
      stdoutPreview: applyResult.stdout.slice(0, 400),
      stderrPreview: applyResult.stderr.slice(0, 400),
    });

    return {
      cwd,
      exitCode: applyResult.exitCode,
      stdout: applyResult.stdout,
      stderr: applyResult.stderr,
      durationMs: applyResult.durationMs,
      applied: applyResult.exitCode === 0,
      validatedPaths,
    };
  }

  async inspectLocalWebPage(args: {
    url: string;
    maxChars: number;
    timeoutMs: number;
  }): Promise<{
    url: string;
    status: number;
    contentType: string;
    title: string | null;
    bodyPreview: string;
    truncated: boolean;
  }> {
    const url = new URL(args.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only http and https URLs are supported.");
    }

    if (!this.localWebAllowlist.has(url.hostname)) {
      throw new Error(
        `Host "${url.hostname}" is not in AGENT_LOCAL_WEB_ALLOWLIST. Only local/dev targets are allowed.`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "unknown";
      const raw = await response.text();
      const normalized = raw.replace(/\s+/g, " ").trim();
      const truncated = normalized.length > args.maxChars;
      const bodyPreview = truncated ? `${normalized.slice(0, args.maxChars)}...` : normalized;
      const titleMatch = raw.match(/<title[^>]*>(.*?)<\/title>/i);

      return {
        url: url.toString(),
        status: response.status,
        contentType,
        title: titleMatch?.[1]?.trim() ?? null,
        bodyPreview,
        truncated,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async detectPackageManager(
    cwd: string,
    preferred: PackageManager | "auto",
  ): Promise<PackageManager> {
    if (preferred !== "auto") {
      return preferred;
    }

    const candidates: Array<{ file: string; manager: PackageManager }> = [
      { file: "pnpm-lock.yaml", manager: "pnpm" },
      { file: "yarn.lock", manager: "yarn" },
      { file: "package-lock.json", manager: "npm" },
      { file: "package.json", manager: "npm" },
    ];

    for (const candidate of candidates) {
      if (await fileExists(resolve(cwd, candidate.file))) {
        return candidate.manager;
      }
    }

    return "npm";
  }

  private async readPackageJson(
    cwd: string,
  ): Promise<{ scripts?: Record<string, string> } | null> {
    const packageJsonPath = resolve(cwd, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      return null;
    }

    try {
      const raw = await readFile(packageJsonPath, "utf8");
      return JSON.parse(raw) as { scripts?: Record<string, string> };
    } catch {
      return null;
    }
  }

  private detectTestScript(scripts: Record<string, string>): string {
    for (const candidate of ["test", "check", "lint", "evals"]) {
      if (candidate in scripts) {
        return candidate;
      }
    }

    throw new Error("Could not find a runnable test-like script. Expected one of test, check, lint, or evals.");
  }

  private packageManagerExecutable(packageManager: PackageManager): string {
    if (process.platform !== "win32") {
      return packageManager;
    }

    return `${packageManager}.cmd`;
  }

  private gitExecutable(): string {
    return process.platform === "win32" ? "git.exe" : "git";
  }

  private extractAndValidatePatchPaths(patch: string): string[] {
    const paths = new Set<string>();
    const lines = patch.split(/\r?\n/);

    for (const line of lines) {
      if (line.startsWith("diff --git ")) {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (match) {
          paths.add(match[1]);
          paths.add(match[2]);
        }
        continue;
      }

      if (line.startsWith("+++ ") || line.startsWith("--- ")) {
        const rawPath = line.slice(4).trim();
        if (!rawPath || rawPath === "/dev/null") {
          continue;
        }

        const normalizedPath =
          rawPath.startsWith("a/") || rawPath.startsWith("b/")
            ? rawPath.slice(2)
            : rawPath;
        paths.add(normalizedPath);
      }
    }

    if (paths.size === 0) {
      throw new Error("Patch did not contain any file paths.");
    }

    for (const path of paths) {
      this.resolveWithinRoot(path);
    }

    return [...paths].sort();
  }

  private resolveWithinRoot(targetPath: string): string {
    const absolute = resolve(this.rootDir, targetPath);
    const rel = relative(this.rootDir, absolute);
    if (rel.startsWith("..") || rel.includes(`${sep}..${sep}`) || rel === "..") {
      throw new Error(`Path "${targetPath}" escapes the workspace root.`);
    }

    return absolute;
  }

  private async walk(
    currentDir: string,
    results: string[],
    options: { maxResults: number; query?: string },
  ): Promise<void> {
    if (results.length >= options.maxResults) {
      return;
    }

    const entries = await readdir(currentDir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (results.length >= options.maxResults) {
        return;
      }

      if (DEFAULT_IGNORES.has(entry.name)) {
        continue;
      }

      const absolutePath = resolve(currentDir, entry.name);
      const relativePath = relative(this.rootDir, absolutePath);

      if (entry.isDirectory()) {
        await this.walk(absolutePath, results, options);
        continue;
      }

      if (!options.query || relativePath.toLowerCase().includes(options.query)) {
        results.push(relativePath);
      }
    }
  }

  private mapCommand(
    action: "pwd" | "ls" | "rg" | "git_status" | "git_diff",
    commandArgs: string[],
  ): { command: string; args: string[] } {
    switch (action) {
      case "pwd":
        return { command: process.platform === "win32" ? "cd" : "pwd", args: [] };
      case "ls":
        return {
          command: process.platform === "win32" ? "dir" : "ls",
          args: commandArgs.length ? commandArgs : ["-la"],
        };
      case "rg":
        return { command: "rg", args: commandArgs };
      case "git_status":
        return { command: this.gitExecutable(), args: ["status", "--short", ...commandArgs] };
      case "git_diff":
        return { command: this.gitExecutable(), args: ["diff", "--", ...commandArgs] };
      default: {
        const exhaustiveCheck: never = action;
        throw new Error(`Unsupported shell action: ${exhaustiveCheck}`);
      }
    }
  }

  private async runBuiltinCommand(args: {
    action: "pwd" | "ls" | "rg" | "git_status" | "git_diff";
    commandArgs: string[];
    cwd: string;
    maxOutputChars: number;
  }): Promise<WorkspaceCommandResult | null> {
    if (args.action === "pwd") {
      return {
        command: "pwd",
        args: [],
        cwd: args.cwd,
        exitCode: 0,
        stdout: args.cwd,
        stderr: "",
        durationMs: 0,
        truncated: false,
      };
    }

    if (args.action !== "ls") {
      return null;
    }

    const targetArg = args.commandArgs.find((item) => !item.startsWith("-"));
    const targetDir = targetArg ? this.resolveWithinRoot(resolve(args.cwd, targetArg)) : args.cwd;
    const entries = await readdir(targetDir, { withFileTypes: true });
    const renderedLines: string[] = [];

    for (const entry of entries) {
      const absolutePath = resolve(targetDir, entry.name);
      const metadata = await stat(absolutePath);
      const kind = entry.isDirectory() ? "dir " : "file";
      renderedLines.push(
        `${kind}\t${metadata.size.toString().padStart(8, " ")}\t${relative(this.rootDir, absolutePath) || entry.name}`,
      );
    }

    const stdout = renderedLines.join("\n");
    const truncated = stdout.length > args.maxOutputChars;
    return {
      command: "ls",
      args: targetArg ? [targetArg] : [],
      cwd: args.cwd,
      exitCode: 0,
      stdout: truncated ? `${stdout.slice(0, args.maxOutputChars)}...` : stdout,
      stderr: "",
      durationMs: 0,
      truncated,
    };
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function execFileSafe(args: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
  stdinText?: string;
}): Promise<WorkspaceCommandResult> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const invocation = toSpawnInvocation(args.command, args.args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: args.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    const startedAt = Date.now();

    const limitOutput = (current: string, chunk: Buffer): string => {
      if (truncated) {
        return current;
      }

      const next = current + chunk.toString("utf8");
      if (next.length > args.maxOutputChars) {
        truncated = true;
        return `${next.slice(0, args.maxOutputChars)}...`;
      }

      return next;
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Command timed out after ${args.timeoutMs}ms.`));
    }, args.timeoutMs);

    if (args.stdinText) {
      child.stdin.write(args.stdinText, "utf8");
    }
    child.stdin.end();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = limitOutput(stdout, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = limitOutput(stderr, chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({
        command: args.command,
        args: args.args,
        cwd: args.cwd,
        exitCode: exitCode ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
        truncated,
      });
    });
  });
}

function toSpawnInvocation(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args };
  }

  const comSpec = process.env.ComSpec ?? "cmd.exe";
  const commandLine = [quoteForCmd(command), ...args.map((arg) => quoteForCmd(arg))].join(" ");
  return {
    command: comSpec,
    args: ["/d", "/s", "/c", commandLine],
  };
}

function quoteForCmd(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (!/[()\s^&|<>"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
