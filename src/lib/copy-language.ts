export const COPY_LANGUAGES = [
  "pt-BR",
  "en",
  "fr",
  "de",
] as const;

export type CopyLanguage =
  (typeof COPY_LANGUAGES)[number];

export const DEFAULT_COPY_LANGUAGE: CopyLanguage =
  "en";

export const COPY_LANGUAGE_OPTIONS: Array<{
  value: CopyLanguage;
  label: string;
}> = [
  {
    value: "en",
    label: "English — USD",
  },
];

export function isCopyLanguage(
  value: unknown
): value is CopyLanguage {
  return value === "en";
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
