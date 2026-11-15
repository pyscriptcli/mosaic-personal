export type AppPage = "dashboard" | "tasks" | "notebook" | "meetings" | "minutes" | "business-analysis";
export type FeatureId = "ask-echo" | "notetaker-record" | "notetaker-upload" | "meetings-export";

export type FeatureAccessRule = { email: string; allowedFeatures?: string[]; allowedPages?: string[] };
export type AccessConfig = {
  defaultPageAccess?: string[];
  defaultFeatureAccess?: string[];
  pagePermissions?: FeatureAccessRule[];
  features?: { askEchoEnabled?: boolean };
};

export const ALL_APP_PAGES: AppPage[] = ["dashboard", "tasks", "notebook", "meetings", "minutes", "business-analysis"];
export const ALL_FEATURES: FeatureId[] = ["ask-echo", "notetaker-record", "notetaker-upload", "meetings-export"];
export const FEATURE_CATALOG: Record<FeatureId, { label: string; requiredPage?: AppPage; global?: "askEchoEnabled" }> = {
  "ask-echo": { label: "Ask Echo", global: "askEchoEnabled" },
  "notetaker-record": { label: "Record meetings", requiredPage: "minutes" },
  "notetaker-upload": { label: "Upload meeting material", requiredPage: "minutes" },
  "meetings-export": { label: "Export meeting minutes", requiredPage: "meetings" },
};

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();
const validPages = (values: unknown, fallback: AppPage[]): AppPage[] => {
  const list = Array.isArray(values) ? values.filter((value): value is AppPage => ALL_APP_PAGES.includes(value as AppPage)) : [];
  return Array.from(new Set(list.length ? list : fallback));
};
export function normalizeFeatures(values: unknown, fallback: FeatureId[] = ALL_FEATURES): FeatureId[] {
  if (values === undefined || values === null) return Array.from(new Set(fallback));
  if (!Array.isArray(values)) return [];
  const list = values.filter((value): value is FeatureId => ALL_FEATURES.includes(value as FeatureId));
  return Array.from(new Set(list));
}
export function globalFeatureAvailable(feature: FeatureId, config: AccessConfig): boolean {
  const mapping = FEATURE_CATALOG[feature].global;
  if (mapping === "askEchoEnabled") return config.features?.askEchoEnabled !== false;
  return true;
}
export function resolveAccess(email: string, config: AccessConfig): { allowedPages: AppPage[]; allowedFeatures: FeatureId[] } {
  const defaultPages = validPages(config.defaultPageAccess, ["dashboard", "meetings", "minutes", "tasks", "notebook", "business-analysis"]);
  const defaultFeatures = normalizeFeatures(config.defaultFeatureAccess, ALL_FEATURES);
  const rule = config.pagePermissions?.find((entry) => normalize(entry.email) === normalize(email));
  const allowedPages = validPages(rule?.allowedPages, defaultPages);
  const selectedFeatures = normalizeFeatures(rule?.allowedFeatures, defaultFeatures);
  const allowedFeatures = selectedFeatures.filter((feature) => {
    const metadata = FEATURE_CATALOG[feature];
    return globalFeatureAvailable(feature, config) && (!metadata.requiredPage || allowedPages.includes(metadata.requiredPage));
  });
  return { allowedPages, allowedFeatures };
}
export function canUseFeature(feature: string, access: { allowedFeatures: FeatureId[] }): feature is FeatureId {
  return ALL_FEATURES.includes(feature as FeatureId) && access.allowedFeatures.includes(feature as FeatureId);
}
