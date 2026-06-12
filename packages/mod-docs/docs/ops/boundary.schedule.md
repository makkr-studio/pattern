A time trigger: `cron` ("*/5 * * * *") or `intervalMs` in config. Each firing
starts a run with `timestamp`/`scheduledFor`. The schedule host arms and
re-arms from the registered workflows — edit the workflow, the schedule
follows.
