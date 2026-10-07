import { useLanguage, useMessages } from '../i18n';

export function LanguageSwitch({ onSwitch }: { onSwitch?: () => void }) {
  const t = useMessages();
  const [language, setLanguage] = useLanguage();

  return (
    <button
      className="link"
      lang={language === 'en' ? 'ko' : 'en'}
      aria-label={t.switchLanguage}
      onClick={() => {
        setLanguage(language === 'en' ? 'ko' : 'en');
        onSwitch?.();
      }}
      type="button"
    >
      {t.otherLanguage}
    </button>
  );
}
