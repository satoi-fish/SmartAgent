# SmartAgent Deployment

## Local production-style run

1. Install dependencies:
   `npm install`
2. Create your environment file:
   `copy .env.example .env`
3. Build:
   `npm run build`
4. Start the control plane:
   `npm start`

The server exposes:
- `/` for the actionable console
- `/observability` for the run-inspection workbench
- `/healthz` for health checks

## Recommended environment

- `WORKBENCH_HOST=0.0.0.0` when exposing the server outside localhost
- `WORKBENCH_PORT=4173`
- `WORKBENCH_API_TOKEN=<strong-random-token>` to require bearer auth for all mutating control endpoints
- `AGENT_PERSIST_RUN_LOG=true` so console-triggered runs are visible in the observability view
- `REDIS_URL` or `POSTGRES_URL` if you want durable shared session backends

## Docker

Build:
`docker build -t smartagent .`

Run:
`docker run --rm -p 4173:4173 --env-file .env smartagent`

If you set `WORKBENCH_API_TOKEN`, include it in the browser console as a bearer token before using mutating actions.
