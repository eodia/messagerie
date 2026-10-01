/**
 * The name an anonymous visitor gets until they give theirs: « Visiteur 9F0C ». It tells
 * two visitors apart in the inbox; it is no one's name — the AI never calls them by it.
 */
export const generatedName = (code: string): string => `Visiteur ${code}`

const GENERATED = /^Visiteur [0-9A-F]{4}$/

export const isGeneratedName = (name: string | null | undefined): boolean =>
  name === null || name === undefined || name.trim() === '' || GENERATED.test(name.trim())
