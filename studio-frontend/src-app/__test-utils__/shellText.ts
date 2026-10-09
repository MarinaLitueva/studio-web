import { screenText } from '@constructor-studio/mfe-shared';
import en from '@/app/i18n/en.json';

const dictionary = en as Record<string, string>;

export const useShellText = () =>
  screenText(
    (key, params) =>
      (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? '')),
    'en'
  );
