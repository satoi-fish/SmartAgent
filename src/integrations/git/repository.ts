import { spawn } from "node:child_process";
import { relative, resolve, sep } from "node:path";

export interface GitChangedFile {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
}

export interface GitRepositorySummary {
  root: string;
  cwd: string;
  branch: string;
  ahead: number;
  behind: number;
  isClean: boolean;
  changedFiles: GitChangedFile[];
}

export class GitRepositoryService {
  private readonly rootDir: string;

  constructor(rootDir = process.env.AGENT_WORKSPACE_ROOT ? resolve(process.env.AGENT_WORKSPACE_ROOT) : process.cwd()) {
    this.rootDir = rootDir;
  }

  async getSummary(cwd = "."): Promise<GitRepositorySummary> {
    const resolvedCwd = this.resolveWithinRoot(cwd);
    const branchOutput = await this.execGit(["status", "--short", "--branch"], resolvedCwd);
    const lines = branchOutput.stdout.split(/\r?\n/).filter(Boolean);
    const header = lines.shift() ?? "## HEAD";
    const branchMatch = header.match(/^##\s+([^\s.]+)(?:\.\.\.[^\s]+)?(?:\s+\[(.+)\])?/);
    const branch = branchMatch?.[1] ?? "HEAD";
    const aheadBehind = branchMatch?.[2] ?? "";
    const ahead = Number(aheadBehind.match(/ahead (\d+)/)?.[1] ?? "0");
    const behind = Number(aheadBehind.match(/behind (\d+)/)?.[1] ?? "0");

    const changedFiles = lines.map((line) => ({
      indexStatus: line.slice(0, 1).trim() || ".",
      workTreeStatus: line.slice(1, 2).trim() || ".",
      path: line.slice(3).trim(),
    }));

    return {
      root: this.rootDir,
      cwd: resolvedCwd,
      branch,
      ahead,
      behind,
      isClean: changedFiles.length === 0,
      changedFiles,
    };
  }

  async stagePaths(args: { cwd?: string; paths: string[] }): Promise<GitRepositorySummary> {
    if (args.paths.length === 0) {
      throw new Error("At least one path is required to stage git changes.");
    }

    const resolvedCwd = this.resolveWithinRoot(args.cwd ?? ".");
    const validatedPaths = args.paths.map((path) => {
      const absolute = this.resolveWithinRoot(resolve(resolvedCwd, path));
      return relative(resolvedCwd, absolute) || ".";
    });

    await this.execGit(["add", "--", ...validatedPaths], resolvedCwd);
    return await this.getSummary(relative(this.rootDir, resolvedCwd) || ".");
  }

  async createCommit(args: { cwd?: string; message: string }): Promise<GitRepositorySummary> {
    const resolvedCwd = this.resolveWithinRoot(args.cwd ?? ".");
    const trimmedMessage = args.message.trim();
    if (!trimmedMessage) {
      throw new Error("Commit message cannot be empty.");
    }

    await this.execGit(["commit", "-m", trimmedMessage], resolvedCwd);
    return await this.getSummary(relative(this.rootDir, resolvedCwd) || ".");
  }

  private resolveWithinRoot(targetPath: string): string {
    const absolute = resolve(this.rootDir, targetPath);
    const rel = relative(this.rootDir, absolute);
    if (rel.startsWith("..") || rel.includes(`${sep}..${sep}`) || rel === "..") {
      throw new Error(`Path "${targetPath}" escapes the workspace root.`);
    }

    return absolute;
  }

  private async execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return await new Promise((resolvePromise, rejectPromise) => {
      const command = process.platform === "win32" ? "git.exe" : "git";
      const child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if ((code ?? 1) !== 0) {
          rejectPromise(new Error(stderr.trim() || stdout.trim() || `git exited with code ${code}`));
          return;
        }

        resolvePromise({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  }
}
