export function filterSubscriptionModels(names: string[]): string[] {
  return [...new Set(names)].filter(name => /^(codex|claude):.+$/.test(name))
}
