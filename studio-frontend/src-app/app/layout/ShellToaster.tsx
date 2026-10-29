/** MFEs ask for a toast through the notify action (notifyAction.ts). */

import { Toaster } from '@gears-frontx/ui-kit/toast';
import { useShellText } from '@/app/i18n/shellTranslations';

export function ShellToaster() {
  const t = useShellText();
  return <Toaster limit={2} closeLabel={t('toast_close')} label={t('toast_region')} />;
}
