const LOCALES: Record<string, string> = { en: 'en-GB' };

export function intlLocale(language: string | null | undefined): string {
  return LOCALES[language ?? ''] ?? (language || 'en-GB');
}
