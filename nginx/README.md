# nginx/

**Purpose:** Production nginx config, part of the multi-stage Docker build context.

**Belongs here:** nginx config files for the production build context.

**Never here:** Application business logic; secrets or API keys embedded directly in config.

**CLAUDE.md rule:** CLAUDE.md line 72.

**Status:** Foundation only — empty until there is a deployable service to front.

**Verification:** `docker compose config` validates the service definition without error (once a compose file exists).
