# Deployment Playbook

Production deploys should go through CI rather than manual shell commands.

Every production release should include:

- a release owner
- a rollback plan
- a deployment window
- a linked ticket or change request

If risk is elevated, prefer a canary or phased rollout before full traffic.

After deployment, the team should confirm:

- health checks are green
- error rate is stable
- dashboards show expected throughput
- user-facing smoke tests passed
