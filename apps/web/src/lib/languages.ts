import { intlLocale } from './i18n'

/**
 * A language named in the reader's: `de` reads « allemand ». The conversations carry codes
 * (ISO 639-1); `Intl` knows their names in every language the inbox will speak.
 */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(intlLocale(), { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** The inbox's own language: a conversation in another one is read translated. */
export const teamLanguage = (): string => intlLocale().slice(0, 2)
