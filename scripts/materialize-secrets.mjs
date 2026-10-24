// Writes Cloudflare secrets to a private temp file for `wrangler deploy
// --secrets-file`. Values come from GitHub Actions secrets via env; they are
// never printed or committed.
import { mkdirSync, writeFileSync } from "node:fs";

if (!process.env.RUNNER_TEMP) {
  console.error("RUNNER_TEMP is not set");
  process.exit(1);
}

const secrets = {
  SESSION_SECRET: process.env.SESSION_SECRET,
  SETUP_SECRET: process.env.SETUP_SECRET,
};
for (const [key, value] of Object.entries(secrets)) {
  if (!value) {
    console.error(`${key} is missing — configure it as a repository secret`);
    process.exit(1);
  }
}

const path = `${process.env.RUNNER_TEMP}/secrets.json`;
mkdirSync(process.env.RUNNER_TEMP, { recursive: true });
writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
console.log(`secrets written to ${path}`);
