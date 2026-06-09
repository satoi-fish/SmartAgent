import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDir = resolve(process.cwd(), "src", "workbench", "static");
const targetDir = resolve(process.cwd(), "dist", "workbench", "static");

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true, force: true });

process.stdout.write(`Copied workbench static assets to ${targetDir}\n`);
