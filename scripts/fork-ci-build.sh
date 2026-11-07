#!/usr/bin/env bash
# Build only. This does not start a server, publish an artifact, or run a browser.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

# Next.js automatically loads these files even with a separate config directory.
for file in .env .env.local .env.production .env.production.local; do
  if [[ -e "$file" || -L "$file" ]]; then
    echo 'Refusing a build with local Next.js environment files; use a clean checkout.' >&2
    exit 1
  fi
done

config_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/homepage-fork-ci.XXXXXX")"
trap 'rm -rf -- "$config_dir"' EXIT

export HOMEPAGE_CONFIG_DIR="$config_dir"
export CI=true
export NEXT_TELEMETRY_DISABLED=1
export NODE_ENV=production

# JSON is also valid YAML. Never read the operator's config/ or .env files here.
printf '%s\n' '{"extensions":{"network":{"enabled":true,"modes":[{"id":"lan","label":"LAN"}]}}}' >"$config_dir/settings.yaml"
printf '%s\n' '[{"CI":[{"Fixture":{"href":"https://default.example.invalid","extensions":{"network":{"addresses":{"lan":"https://lan.example.invalid"}}}}}]}]' >"$config_dir/services.yaml"
for file in bookmarks widgets; do
  printf '[]\n' >"$config_dir/$file.yaml"
done
for file in docker kubernetes proxmox; do
  printf '{}\n' >"$config_dir/$file.yaml"
done

# Synthetic build-only credentials stay in the child environment, never in YAML.
export HOMEPAGE_AUTH_ENABLED=true
HOMEPAGE_AUTH_SECRET="$(node -p "require('node:crypto').randomBytes(32).toString('base64')")"
HOMEPAGE_AUTH_PASSWORD="$(node -p "require('node:crypto').randomBytes(24).toString('base64')")"
export HOMEPAGE_AUTH_SECRET HOMEPAGE_AUTH_PASSWORD
export HOMEPAGE_EXTERNAL_URL=http://localhost:3000
export HOMEPAGE_ALLOWED_HOSTS=localhost:3000

pnpm build
