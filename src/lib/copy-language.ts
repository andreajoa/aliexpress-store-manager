export const COPY_LANGUAGES = [
  "pt-BR",
  "en",
  "fr",
  "de",
] as const;

export type CopyLanguage =
  (typeof COPY_LANGUAGES)[number];

export const DEFAULT_COPY_LANGUAGE: CopyLanguage =
  "pt-BR";

export const COPY_LANGUAGE_OPTIONS: Array<{
  value: CopyLanguage;
  label: string;
}> = [
  {
    value: "pt-BR",
    label: "Português (Brasil)",
  },
  {
    value: "en",
    label: "English",
  },
  {
    value: "fr",
    label: "Français",
  },
  {
    value: "de",
    label: "Deutsch",
  },
];

export function isCopyLanguage(
  value: unknown
): value is CopyLanguage {
  return (
    typeof value === "string" &&
    COPY_LANGUAGES.includes(
      value as CopyLanguage
    )
  );
}

export function copyLanguageFromVersion(
  value: string | null | undefined
): CopyLanguage {
  const candidate =
    value?.split(":").at(-1);

  return isCopyLanguage(candidate)
    ? candidate
    : DEFAULT_COPY_LANGUAGE;
}
