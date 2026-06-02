import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { BrowserAuditStore } from "./browserAuditStore.js";

export interface BrowserSessionSummary {
  sessionId: string;
  url: string;
  title: string;
}

export class LocalBrowserManager {
  private readonly allowlist: Set<string>;
  private readonly screenshotsDir: string;
  private readonly headless: boolean;
  private browserPromise: Promise<PlaywrightBrowserLike> | null = null;
  private readonly sessions = new Map<string, PlaywrightPageLike>();

  constructor(
    private readonly auditStore = new BrowserAuditStore(),
    env = process.env,
  ) {
    this.allowlist = new Set(
      (env.AGENT_BROWSER_ALLOWLIST ?? env.AGENT_LOCAL_WEB_ALLOWLIST ?? "localhost,127.0.0.1,::1")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    this.screenshotsDir = resolve(process.cwd(), env.AGENT_BROWSER_SCREENSHOTS_DIR ?? ".agent-browser-shots");
    this.headless = (env.AGENT_BROWSER_HEADLESS ?? "true").toLowerCase() !== "false";
  }

  async openPage(args: {
    url: string;
    sessionId?: string;
    timeoutMs: number;
  }): Promise<BrowserSessionSummary> {
    const url = this.ensureAllowedUrl(args.url);
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();
    await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: args.timeoutMs,
    });

    const sessionId = args.sessionId ?? `browser_${randomUUID().slice(0, 10)}`;
    this.sessions.set(sessionId, page);
    const summary = await this.buildSummary(sessionId, page);
    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      sessionId,
      action: "open_page",
      url: summary.url,
      success: true,
    });
    return summary;
  }

  async snapshot(args: {
    sessionId: string;
    maxChars: number;
  }): Promise<{
    sessionId: string;
    url: string;
    title: string;
    bodyPreview: string;
    truncated: boolean;
  }> {
    const page = this.getSession(args.sessionId);
    const title = await page.title();
    const bodyText = await page.locator("body").innerText();
    const normalized = bodyText.replace(/\s+/g, " ").trim();
    const truncated = normalized.length > args.maxChars;
    const bodyPreview = truncated ? `${normalized.slice(0, args.maxChars)}...` : normalized;

    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      sessionId: args.sessionId,
      action: "snapshot",
      url: page.url(),
      success: true,
    });

    return {
      sessionId: args.sessionId,
      url: page.url(),
      title,
      bodyPreview,
      truncated,
    };
  }

  async click(args: {
    sessionId: string;
    selector: string;
    timeoutMs: number;
  }): Promise<BrowserSessionSummary> {
    const page = this.getSession(args.sessionId);
    await page.locator(args.selector).click({
      timeout: args.timeoutMs,
    });
    const summary = await this.buildSummary(args.sessionId, page);
    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      sessionId: args.sessionId,
      action: "click",
      url: summary.url,
      selector: args.selector,
      success: true,
    });
    return summary;
  }

  async type(args: {
    sessionId: string;
    selector: string;
    text: string;
    timeoutMs: number;
    clearFirst: boolean;
  }): Promise<BrowserSessionSummary> {
    const page = this.getSession(args.sessionId);
    const locator = page.locator(args.selector);
    if (args.clearFirst) {
      await locator.fill("", {
        timeout: args.timeoutMs,
      });
    }
    await locator.fill(args.text, {
      timeout: args.timeoutMs,
    });
    const summary = await this.buildSummary(args.sessionId, page);
    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      sessionId: args.sessionId,
      action: "type",
      url: summary.url,
      selector: args.selector,
      detail: `text_length=${args.text.length}`,
      success: true,
    });
    return summary;
  }

  async screenshot(args: {
    sessionId: string;
    fileName?: string;
  }): Promise<{
    sessionId: string;
    url: string;
    screenshotPath: string;
  }> {
    const page = this.getSession(args.sessionId);
    await mkdir(this.screenshotsDir, { recursive: true });
    const screenshotPath = resolve(
      this.screenshotsDir,
      args.fileName ?? `${args.sessionId}-${Date.now()}.png`,
    );
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      sessionId: args.sessionId,
      action: "screenshot",
      url: page.url(),
      detail: screenshotPath,
      success: true,
    });

    return {
      sessionId: args.sessionId,
      url: page.url(),
      screenshotPath,
    };
  }

  async close(args: { sessionId: string }): Promise<{ sessionId: string; closed: boolean }> {
    const page = this.sessions.get(args.sessionId);
    if (!page) {
      return {
        sessionId: args.sessionId,
        closed: false,
      };
    }

    await page.close();
    this.sessions.delete(args.sessionId);
    await this.auditStore.append({
      timestamp: new Date().toISOString(),
      sessionId: args.sessionId,
      action: "close",
      success: true,
    });
    return {
      sessionId: args.sessionId,
      closed: true,
    };
  }

  private getSession(sessionId: string): PlaywrightPageLike {
    const page = this.sessions.get(sessionId);
    if (!page) {
      throw new Error(`No browser session found for ${sessionId}.`);
    }

    return page;
  }

  private ensureAllowedUrl(rawUrl: string): URL {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only http and https URLs are supported for browser automation.");
    }

    if (!this.allowlist.has(url.hostname)) {
      throw new Error(
        `Host "${url.hostname}" is not in AGENT_BROWSER_ALLOWLIST. Only local/dev targets are allowed.`,
      );
    }

    return url;
  }

  private async ensureBrowser(): Promise<PlaywrightBrowserLike> {
    if (!this.browserPromise) {
      this.browserPromise = this.launchBrowser();
    }

    return this.browserPromise;
  }

  private async launchBrowser(): Promise<PlaywrightBrowserLike> {
    const playwrightModule = (await importPackage("playwright")) as PlaywrightModuleLike;
    return await playwrightModule.chromium.launch({
      headless: this.headless,
    });
  }

  private async buildSummary(sessionId: string, page: PlaywrightPageLike): Promise<BrowserSessionSummary> {
    return {
      sessionId,
      url: page.url(),
      title: await page.title(),
    };
  }
}

async function importPackage(specifier: string): Promise<unknown> {
  try {
    const dynamicImport = new Function("s", "return import(s);") as (s: string) => Promise<unknown>;
    return await dynamicImport(specifier);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Optional package "${specifier}" is required for browser automation. Install it before using browser tools. Original error: ${reason}`,
    );
  }
}

interface PlaywrightModuleLike {
  chromium: {
    launch(options: { headless: boolean }): Promise<PlaywrightBrowserLike>;
  };
}

interface PlaywrightBrowserLike {
  newPage(): Promise<PlaywrightPageLike>;
}

interface PlaywrightPageLike {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  close(): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  locator(selector: string): PlaywrightLocatorLike;
}

interface PlaywrightLocatorLike {
  innerText(): Promise<string>;
  click(options: { timeout: number }): Promise<void>;
  fill(value: string, options: { timeout: number }): Promise<void>;
}
