export type CodexModelRecord = {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  hidden?: unknown;
};

export type CodexModelOption = { value: string; label: string };

export function normalizeCodexModels(value: unknown): CodexModelOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): CodexModelOption[] => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry as CodexModelRecord;
    const value = typeof model.model === "string" && model.model.trim()
      ? model.model.trim()
      : typeof model.id === "string" ? model.id.trim() : "";
    if (!value || model.hidden === true || seen.has(value)) return [];
    seen.add(value);
    const label = typeof model.displayName === "string" && model.displayName.trim()
      ? model.displayName.trim()
      : value;
    return [{ value, label }];
  });
}

export function findLunaMediumModel(models: CodexModelOption[]): string | null {
  return models.find((model) => /luna\s*medium/i.test(`${model.label} ${model.value}`))?.value || null;
}
