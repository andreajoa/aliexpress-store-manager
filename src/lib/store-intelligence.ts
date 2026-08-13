export type StoreCategory = {
  id: string;
  name: string;
  slug: string;
};

export type StoreBrandProfile = {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  surfaceColor?: string | null;
  textColor?: string | null;
  mutedTextColor?: string | null;
  borderColor?: string | null;

  visualStyle?: string | null;

  typography?: {
    body?: string | null;
    display?: string | null;
  };

  palette: string[];
};

export type StoreIntelligence = {
  source: "manifest" | "fallback";
  connectorVersion: string | null;

  niche: string | null;

  brand: StoreBrandProfile;

  categories: StoreCategory[];

  capabilities: Record<
    string,
    unknown
  >;
};

function cleanBaseUrl(
  value: string
) {
  return value.replace(
    /\/+$/,
    ""
  );
}

function slugify(
  value: string
) {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}

function uniqueColors(
  colors: string[]
) {
  return Array.from(
    new Set(
      colors.map(
        color =>
          color.toLowerCase()
      )
    )
  ).slice(0, 12);
}

function normalizeCategories(
  value: unknown
): StoreCategory[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result:
    StoreCategory[] = [];

  for (const item of value) {
    if (
      typeof item ===
      "string"
    ) {
      const name =
        item.trim();

      if (!name) continue;

      result.push({
        id:
          slugify(name),
        name,
        slug:
          slugify(name),
      });

      continue;
    }

    if (
      !item ||
      typeof item !==
        "object"
    ) {
      continue;
    }

    const object =
      item as Record<
        string,
        unknown
      >;

    const name =
      typeof object.name ===
      "string"
        ? object.name.trim()
        : "";

    if (!name) continue;

    result.push({
      id:
        typeof object.id ===
          "string" &&
        object.id.trim()
          ? object.id.trim()
          : slugify(name),

      name,

      slug:
        typeof object.slug ===
          "string" &&
        object.slug.trim()
          ? object.slug.trim()
          : slugify(name),
    });
  }

  const dedup =
    new Map<
      string,
      StoreCategory
    >();

  for (
    const category of
      result
  ) {
    dedup.set(
      category.id,
      category
    );
  }

  return Array.from(
    dedup.values()
  ).sort(
    (a, b) =>
      a.name.localeCompare(
        b.name,
        "pt-BR"
      )
  );
}

async function fetchJson(
  url: string
) {
  const response =
    await fetch(url, {
      headers: {
        Accept:
          "application/json",

        "User-Agent":
          "AliExpress-Store-Manager/1.0",
      },

      cache:
        "no-store",

      signal:
        AbortSignal.timeout(
          15000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `${url} respondeu HTTP ${response.status}`
    );
  }

  return response.json();
}

function stringValue(
  value: unknown
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function brandFromManifest(
  value: unknown
): StoreBrandProfile {
  const object =
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
      ? (value as Record<
          string,
          unknown
        >)
      : {};

  const colors = [
    object.primaryColor,
    object.secondaryColor,
    object.accentColor,
    object.backgroundColor,
    object.surfaceColor,
    object.textColor,
    object.mutedTextColor,
    object.borderColor,
  ]
    .filter(
      (
        value
      ): value is string =>
        typeof value ===
          "string" &&
        /^#[0-9a-f]{6}$/i.test(
          value
        )
    );

  const typographyObject =
    object.typography &&
    typeof object.typography ===
      "object" &&
    !Array.isArray(
      object.typography
    )
      ? (object.typography as Record<
          string,
          unknown
        >)
      : {};

  return {
    primaryColor:
      stringValue(
        object.primaryColor
      ) || null,

    secondaryColor:
      stringValue(
        object.secondaryColor
      ) || null,

    accentColor:
      stringValue(
        object.accentColor
      ) || null,

    backgroundColor:
      stringValue(
        object.backgroundColor
      ) || null,

    surfaceColor:
      stringValue(
        object.surfaceColor
      ) || null,

    textColor:
      stringValue(
        object.textColor
      ) || null,

    mutedTextColor:
      stringValue(
        object.mutedTextColor
      ) || null,

    borderColor:
      stringValue(
        object.borderColor
      ) || null,

    visualStyle:
      stringValue(
        object.visualStyle
      ) || null,

    typography: {
      body:
        stringValue(
          typographyObject.body
        ) || null,

      display:
        stringValue(
          typographyObject.display
        ) || null,
    },

    palette:
      uniqueColors(colors),
  };
}

async function detectBrandFromWebsite(
  baseUrl: string
): Promise<StoreBrandProfile> {
  const base =
    cleanBaseUrl(
      baseUrl
    );

  const response =
    await fetch(base, {
      cache:
        "no-store",

      signal:
        AbortSignal.timeout(
          15000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `Homepage respondeu HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  const stylesheetMatches =
    Array.from(
      html.matchAll(
        /<link[^>]+href=["']([^"']+\.css[^"']*)["'][^>]*>/gi
      )
    )
      .map(
        match =>
          match[1]
      )
      .slice(0, 6);

  const cssTexts:
    string[] = [];

  for (
    const href of
      stylesheetMatches
  ) {
    try {
      const cssUrl =
        new URL(
          href,
          base
        ).toString();

      const cssResponse =
        await fetch(
          cssUrl,
          {
            cache:
              "no-store",

            signal:
              AbortSignal.timeout(
                10000
              ),
          }
        );

      if (
        cssResponse.ok
      ) {
        cssTexts.push(
          await cssResponse.text()
        );
      }
    } catch {
      // fallback não pode
      // derrubar o scan.
    }
  }

  const combined =
    [
      html,
      ...cssTexts,
    ].join("\n");

  const variableMatches =
    Array.from(
      combined.matchAll(
        /--([a-z0-9-_]+)\s*:\s*(#[0-9a-f]{6})/gi
      )
    );

  const variables =
    new Map<
      string,
      string
    >();

  for (
    const match of
      variableMatches
  ) {
    variables.set(
      match[1].toLowerCase(),
      match[2].toLowerCase()
    );
  }

  const allColors =
    Array.from(
      combined.matchAll(
        /#[0-9a-f]{6}\b/gi
      )
    ).map(
      match =>
        match[0]
    );

  const frequency =
    new Map<
      string,
      number
    >();

  for (
    const color of
      allColors
  ) {
    const key =
      color.toLowerCase();

    frequency.set(
      key,
      (frequency.get(
        key
      ) || 0) + 1
    );
  }

  const palette =
    Array.from(
      frequency.entries()
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )
      .map(
        ([color]) =>
          color
      )
      .slice(0, 10);

  function variable(
    names: string[]
  ) {
    for (
      const name of
        names
    ) {
      const value =
        variables.get(
          name
        );

      if (value) {
        return value;
      }
    }

    return null;
  }

  return {
    primaryColor:
      variable([
        "primary",
        "color-primary",
      ]) ||
      palette[0] ||
      null,

    secondaryColor:
      variable([
        "secondary",
        "color-secondary",
      ]) ||
      palette[1] ||
      null,

    accentColor:
      variable([
        "accent",
        "color-accent",
        "secondary-light",
      ]) ||
      palette[2] ||
      null,

    backgroundColor:
      variable([
        "background",
        "color-background",
      ]) ||
      palette[3] ||
      null,

    surfaceColor:
      variable([
        "background-alt",
        "surface",
        "card",
      ]) ||
      palette[4] ||
      null,

    textColor:
      variable([
        "text",
        "foreground",
        "color-text",
      ]) ||
      null,

    mutedTextColor:
      variable([
        "text-light",
        "muted",
        "text-muted",
      ]) ||
      null,

    borderColor:
      variable([
        "border",
        "color-border",
      ]) ||
      null,

    visualStyle:
      "auto-detected",

    typography: {
      body: null,
      display: null,
    },

    palette:
      uniqueColors(
        palette
      ),
  };
}

async function categoriesFromCatalog(
  baseUrl: string
) {
  try {
    const data =
      await fetchJson(
        `${cleanBaseUrl(
          baseUrl
        )}/api/store-connector/catalog`
      );

    const products =
      Array.isArray(
        data?.catalog
          ?.products
      )
        ? data.catalog
            .products
        : [];

    const names =
      products
        .map(
          (
            item: unknown
          ) => {
            if (
              !item ||
              typeof item !==
                "object"
            ) {
              return "";
            }

            const category =
              (
                item as Record<
                  string,
                  unknown
                >
              ).category;

            return typeof category ===
              "string"
              ? category
              : "";
          }
        )
        .filter(Boolean);

    return normalizeCategories(
      names
    );
  } catch {
    return [];
  }
}

export async function scanStoreIntelligence(
  baseUrl: string
): Promise<StoreIntelligence> {
  const base =
    cleanBaseUrl(
      baseUrl
    );

  try {
    const manifest =
      await fetchJson(
        `${base}/api/store-connector/manifest`
      );

    const store =
      manifest?.store;

    if (
      !store ||
      typeof store !==
        "object"
    ) {
      throw new Error(
        "Manifest sem objeto store."
      );
    }

    const storeObject =
      store as Record<
        string,
        unknown
      >;

    const categories =
      normalizeCategories(
        storeObject.categories
      );

    if (
      categories.length ===
      0
    ) {
      throw new Error(
        "Manifest não informou categorias."
      );
    }

    return {
      source:
        "manifest",

      connectorVersion:
        stringValue(
          manifest.connectorVersion
        ) || null,

      niche:
        stringValue(
          storeObject.niche
        ) || null,

      brand:
        brandFromManifest(
          storeObject.brand
        ),

      categories,

      capabilities:
        storeObject.capabilities &&
        typeof storeObject.capabilities ===
          "object"
          ? (storeObject.capabilities as Record<
              string,
              unknown
            >)
          : {},
    };
  } catch (
    manifestError
  ) {
    console.warn(
      "[Store Intelligence] manifest indisponível:",
      manifestError instanceof
        Error
        ? manifestError.message
        : manifestError
    );
  }

  const [
    brand,
    categories,
  ] =
    await Promise.all([
      detectBrandFromWebsite(
        base
      ),

      categoriesFromCatalog(
        base
      ),
    ]);

  return {
    source:
      "fallback",

    connectorVersion:
      null,

    niche:
      null,

    brand,

    categories,

    capabilities: {},
  };
}
