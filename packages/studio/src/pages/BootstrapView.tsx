import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { postApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import { GlobalConfigPanel } from "../components/GlobalConfigPanel";
import type { BootstrapSummary } from "../shared/contracts";

export function BootstrapView({
  bootstrap,
  theme,
  t,
  onInitialized,
}: {
  bootstrap: BootstrapSummary;
  theme: Theme;
  t: TFunction;
  onInitialized: () => void;
}) {
  const c = useColors(theme);
  const [projectName, setProjectName] = useState(bootstrap.suggestedProjectName);
  const [language, setLanguage] = useState<"ko" | "zh" | "en">(bootstrap.globalConfig.language);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInitialize = async () => {
    setCreating(true);
    setError(null);
    try {
      await postApi("/project/init", {
        name: projectName.trim() || bootstrap.suggestedProjectName,
        language,
      });
      onInitialized();
    } catch (initError) {
      setError(initError instanceof Error ? initError.message : "Failed to initialize project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-5 py-8 sm:px-6 md:px-10 lg:py-16 space-y-6 sm:space-y-8">
        <div className="space-y-2.5 sm:space-y-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-bold">
            InkOS Studio
          </div>
          <h1 className="font-serif max-w-3xl text-[clamp(2.25rem,8vw,3.6rem)] leading-[0.96]">{t("boot.title")}</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            {t("boot.subtitle")}
          </p>
          <div className="inline-flex max-w-full items-center rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] text-muted-foreground sm:text-xs">
            {t("boot.pathLabel")} · <span className="ml-1 truncate">{bootstrap.root}</span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] items-start">
          <div className={`border ${c.cardStatic} rounded-xl p-5 sm:p-6 space-y-6`}>
            <div>
              <h2 className="font-serif text-2xl">{t("boot.initTitle")}</h2>
              <p className="text-sm text-muted-foreground mt-2">{t("boot.initHint")}</p>
            </div>

            {error && (
              <div className={`border ${c.error} rounded-md px-4 py-3 text-sm`}>
                {error}
              </div>
            )}

            <label className="block">
              <div className="text-sm text-muted-foreground mb-2">{t("config.project")}</div>
              <input
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className={`${c.input} rounded-md px-4 py-3 w-full`}
              />
            </label>

            <label className="block">
              <div className="text-sm text-muted-foreground mb-2">{t("config.language")}</div>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as "ko" | "zh" | "en")}
                className={`${c.input} rounded-md px-4 py-3 w-full`}
              >
                <option value="ko">{t("config.korean")}</option>
                <option value="zh">{t("config.chinese")}</option>
                <option value="en">{t("config.english")}</option>
              </select>
            </label>

            <div className={`border ${c.info} rounded-md px-4 py-3 text-sm`}>
              {t("boot.globalHint")}
            </div>

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {t("boot.createsLabel")}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
                <div className="rounded-lg border border-border/50 bg-background/70 px-4 py-3 text-sm text-foreground">
                  {t("boot.createsConfig")}
                </div>
                <div className="rounded-lg border border-border/50 bg-background/70 px-4 py-3 text-sm text-foreground">
                  {t("boot.createsBooks")}
                </div>
                <div className="rounded-lg border border-border/50 bg-background/70 px-4 py-3 text-sm text-foreground">
                  {t("boot.createsReuse")}
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleInitialize}
                disabled={creating}
                className={`w-full sm:w-auto px-5 py-3 rounded-md text-sm ${c.btnPrimary} disabled:opacity-50`}
              >
                {creating ? t("boot.initializing") : t("boot.initialize")}
              </button>
            </div>
          </div>

          <GlobalConfigPanel
            theme={theme}
            t={t}
            title={t("config.globalTitle")}
            onSaved={(summary) => setLanguage(summary.language)}
          />
        </div>
      </div>
    </div>
  );
}
