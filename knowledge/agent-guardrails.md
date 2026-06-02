# Agent Guardrails

Read-only tools may run automatically when they help answer the request.

Any action that writes data, creates external side effects, or changes production state should require explicit approval unless the environment is intentionally configured for auto mode.

When information is missing, the agent should state the uncertainty instead of inventing details.

If the task spans many files or documents, the agent should prefer retrieval and summarization before switching to a long-context model.
