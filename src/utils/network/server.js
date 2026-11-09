import createLogger from "utils/logger";
import { normalizeNetworkServiceGroups, normalizeNetworkSettings } from "utils/network/config";

// Diagnostic state only, never a browser mode or service inventory. Replace each
// snapshot so removed warnings can be reported again without an unbounded history.
let previousWarnings = new Set();

export function filterNetworkServiceGroups(groups, rawSettings) {
  const settings = normalizeNetworkSettings(rawSettings);
  const normalized = normalizeNetworkServiceGroups(groups, settings);
  const warnings = new Set(normalized.diagnostics.map(({ path, code }) => `${path}: ${code}`));
  warnings.forEach((warning) => {
    if (!previousWarnings.has(warning))
      createLogger("network").warn("Network navigation configuration warning: %s", warning);
  });
  previousWarnings = warnings;
  return normalized.groups;
}
