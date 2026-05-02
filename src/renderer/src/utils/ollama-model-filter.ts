export function filterOllamaModels(modelNames: string[]): string[] {
  return modelNames.filter((name) => {
    const lower = name.toLowerCase()
    if (lower.startsWith('x/')) return false
    if (lower.includes('embedding')) return false
    return true
  })
}
