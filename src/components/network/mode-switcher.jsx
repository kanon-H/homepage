import { useTranslation } from "next-i18next/pages";

import { useNetwork } from "utils/contexts/network";

export default function ModeSwitcher() {
  const { t } = useTranslation();
  const { settings, mode, ready, setMode } = useNetwork();
  if (!settings.enabled || settings.modes.length < 2) return null;

  return (
    <label className="network-mode-switcher ml-auto my-2 flex min-w-0 max-w-full items-center gap-2 text-theme-700 dark:text-theme-200">
      <span className="shrink-0 text-xs">{t("network.mode")}</span>
      <select
        aria-label={t("network.mode")}
        aria-busy={!ready}
        title={!ready ? t("network.restoring") : undefined}
        value={mode}
        disabled={!ready}
        onChange={(event) => setMode(event.target.value)}
        className="min-w-0 max-w-48 rounded-md border-0 bg-theme-100 dark:bg-theme-800 py-2 text-sm focus:ring-2 focus:ring-theme-500 disabled:opacity-50"
      >
        {settings.modes.map(({ id, label }) => (
          <option key={id} value={id}>
            {label ?? t("network.default")}
          </option>
        ))}
      </select>
    </label>
  );
}
