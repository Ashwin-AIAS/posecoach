# Database Backup & Restore

Weekly backups run via `.github/workflows/db-backup.yml` — `pg_dump` (custom
format, `-Fc`) against `secrets.NEON_DIRECT_URL`, uploaded as a workflow
artifact named `posecoach-YYYY-MM-DD.dump` (90-day retention). It also runs
on demand from the **Actions** tab (`workflow_dispatch`).

## Restoring a dump

1. Download the artifact from the workflow run (Actions → the run →
   Artifacts) and unzip it to get the `.dump` file.
2. Restore into a target Postgres database:

   ```bash
   pg_restore --clean --if-exists --no-owner --no-privileges \
     -d "$TARGET_DATABASE_URL" \
     posecoach-YYYY-MM-DD.dump
   ```

   - `--clean --if-exists` drops existing objects before recreating them —
     omit both if restoring into an empty database.
   - `--no-owner --no-privileges` avoids failures from role names that
     don't exist on the target (e.g. restoring a Neon dump elsewhere).
   - Never restore directly into production without first restoring into a
     scratch database and checking it.

3. Run `alembic upgrade head` afterward if the dump predates the current
   migration head.

Never paste `$TARGET_DATABASE_URL` (or `NEON_DIRECT_URL`) into a shell
history, log, or commit — export it as an environment variable instead.
