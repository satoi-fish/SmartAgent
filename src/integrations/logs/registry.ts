import { SeqLogAdapter } from "./adapters/seq.js";
import { LogService } from "./service.js";

export function createLogServiceFromEnv(env: NodeJS.ProcessEnv): LogService | null {
  const platform = (env.AGENT_LOG_PLATFORM ?? "").trim().toLowerCase();

  if (!platform || platform === "none") {
    return null;
  }

  if (platform === "seq") {
    const baseUrl = env.SEQ_BASE_URL?.trim();
    if (!baseUrl) {
      throw new Error("AGENT_LOG_PLATFORM is set to seq, but SEQ_BASE_URL is missing.");
    }

    return new LogService(
      new SeqLogAdapter({
        baseUrl,
        apiKey: env.SEQ_API_KEY?.trim() || undefined,
        signal: env.SEQ_SIGNAL?.trim() || undefined,
        defaultFilter: env.SEQ_DEFAULT_FILTER?.trim() || undefined,
        serviceProperty: env.SEQ_SERVICE_PROPERTY?.trim() || undefined,
        environmentProperty: env.SEQ_ENVIRONMENT_PROPERTY?.trim() || undefined,
        requestIdProperty: env.SEQ_REQUEST_ID_PROPERTY?.trim() || undefined,
        deployShaProperty: env.SEQ_DEPLOY_SHA_PROPERTY?.trim() || undefined,
        versionProperty: env.SEQ_VERSION_PROPERTY?.trim() || undefined,
      }),
    );
  }

  throw new Error(`Unsupported AGENT_LOG_PLATFORM "${platform}".`);
}
