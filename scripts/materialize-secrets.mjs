// Writes Cloudflare secrets to a private temp file for `wrangler deploy
// --secrets-file`, and patches worker/wrangler.toml placeholders (account id,
// D1 database name/id, TABLE_PREFIX) from GitHub Actions vars. Values come
// from env; they are never printed or committed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.env.RUNNER_TEMP) {
  console.error("RUNNER_TEMP is not set");
  process.exit(1);
}

// ─── Secrets (wrangler --secrets-file) ───────────────────────────────────────
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

const secretsPath = `${process.env.RUNNER_TEMP}/secrets.json`;
mkdirSync(process.env.RUNNER_TEMP, { recursive: true });
writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
console.log(`secrets written to ${secretsPath}`);

// ─── wrangler.toml placeholders (org-level shared config) ───────────────────
// Required organization variables; fail fast so a deploy never ships a
// placeholder as a real value.
const required = {
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_NAME: process.env.D1_DATABASE_NAME,
  D1_DATABASE_ID: process.env.D1_DATABASE_ID,
};
for (const [name, value] of Object.entries(required)) {
  if (!value) {
    console.error(
      `${name} is missing — configure it as an organization variable`,
    );
    process.exit(1);
  }
}

// TABLE_PREFIX three-state (SPEC v1.4): unset/empty → project default "nav_",
// reserved word "none" → "" (explicit no-prefix), anything else → as-is.
const DEFAULT_TABLE_PREFIX = "nav_";
function resolveTablePrefix(raw) {
  if (raw === undefined || raw === "") return DEFAULT_TABLE_PREFIX;
  if (raw === "none") return "";
  return raw;
}
const tablePrefix = resolveTablePrefix(process.env.TABLE_PREFIX);

const wranglerPath = fileURLToPath(
  new URL("../worker/wrangler.toml", import.meta.url),
);
let toml = readFileSync(wranglerPath, "utf8");

const replacements = {
  CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER: required.CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_NAME_PLACEHOLDER: required.D1_DATABASE_NAME,
  D1_DATABASE_ID_PLACEHOLDER: required.D1_DATABASE_ID,
};
for (const [placeholder, value] of Object.entries(replacements)) {
  toml = toml.replaceAll(placeholder, value);
}

// Append the [vars] table with the resolved prefix. The committed wrangler.toml
// intentionally has no [vars] section so an unconfigured deployment falls back
// to the Worker's DEFAULT_TABLE_PREFIX; deploy always pins a concrete value.
toml += `\n[vars]\nTABLE_PREFIX = ${JSON.stringify(tablePrefix)}\n`;

if (toml.includes("_PLACEHOLDER")) {
  console.error("Unreplaced placeholder remains in wrangler.toml");
  process.exit(1);
}

writeFileSync(wranglerPath, toml);
console.log(
  `wrangler.toml config resolved (TABLE_PREFIX=${JSON.stringify(tablePrefix)})`,
);
