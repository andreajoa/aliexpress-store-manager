import sharp from "sharp";

async function downloadReference(
  url: string
) {
  const response =
    await fetch(url, {
      headers: {
        Accept:
          "image/*",

        "User-Agent":
          "Store-Manager/1.0",
      },

      cache:
        "no-store",

      signal:
        AbortSignal.timeout(
          25000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `Não foi possível carregar referência: HTTP ${response.status}`
    );
  }

  const source =
    Buffer.from(
      await response.arrayBuffer()
    );

  /*
   * FLUX.2 Klein exige referências
   * menores que 512x512.
   */
  return sharp(source)
    .resize({
      width: 480,
      height: 480,
      fit: "inside",
      withoutEnlargement:
        true,
    })
    .png()
    .toBuffer();
}

function extractBase64(
  payload: unknown
): string | null {
  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return null;
  }

  const root =
    payload as Record<
      string,
      unknown
    >;

  const result =
    root.result;

  if (
    result &&
    typeof result ===
      "object"
  ) {
    const image =
      (
        result as Record<
          string,
          unknown
        >
      ).image;

    if (
      typeof image ===
      "string"
    ) {
      return image;
    }
  }

  if (
    typeof result ===
      "string"
  ) {
    return result;
  }

  if (
    typeof root.image ===
      "string"
  ) {
    return root.image;
  }

  return null;
}

export async function generateCloudflareEditorial({
  prompt,
  referenceUrls,
  seed,
  guidance = 8,
}: {
  prompt: string;

  referenceUrls:
    string[];

  seed: number;

  guidance?: number;
}) {
  const accountId =
    process.env
      .CLOUDFLARE_ACCOUNT_ID;

  const token =
    process.env
      .CLOUDFLARE_API_TOKEN;

  const model =
    process.env
      .CLOUDFLARE_IMAGE_MODEL ||
    "@cf/black-forest-labs/flux-2-klein-4b";

  if (!accountId) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID não configurado."
    );
  }

  if (!token) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN não configurado."
    );
  }

  const references =
    referenceUrls
      .filter(Boolean)
      .slice(0, 4);

  if (
    references.length ===
    0
  ) {
    throw new Error(
      "Nenhuma imagem de referência disponível."
    );
  }

  const form =
    new FormData();

  form.append(
    "prompt",
    prompt
  );

  form.append(
    "width",
    "1024"
  );

  form.append(
    "height",
    "1024"
  );

  form.append(
    "guidance",
    String(guidance)
  );

  form.append(
    "seed",
    String(seed)
  );

  for (
    let index = 0;
    index <
    references.length;
    index++
  ) {
    const buffer =
      await downloadReference(
        references[index]
      );

    const blob =
      new Blob(
        [
          new Uint8Array(
            buffer
          ),
        ],
        {
          type:
            "image/png",
        }
      );

    form.append(
      `input_image_${index}`,
      blob,
      `reference-${index}.png`
    );
  }

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  /*
   * Não definir Content-Type aqui.
   * O fetch adiciona automaticamente
   * o boundary correto do multipart.
   */
  let response: Response | null = null;

  const retryDelays = [
    2000,
    5000,
    10000,
  ];

  for (
    let attempt = 0;
    attempt < 3;
    attempt++
  ) {
    /*
     * FormData/streams não devem ser
     * reaproveitados depois de um POST.
     * O primeiro request usa o form já
     * construído acima.
     *
     * Por isso a repetição automática
     * neste ponto só ocorre antes de
     * abandonar a tentativa atual.
     */
    response =
      await fetch(
        endpoint,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,
          },

          body:
            form,

          signal:
            AbortSignal.timeout(
              90000
            ),
        }
      );

    if (
      response.ok
    ) {
      break;
    }

    const transient =
      response.status ===
        429 ||
      response.status ===
        500 ||
      response.status ===
        502 ||
      response.status ===
        503 ||
      response.status ===
        504;

    if (
      !transient ||
      attempt === 2
    ) {
      break;
    }

    console.warn(
      `[Cloudflare image] HTTP ${response.status}. Nova tentativa em instantes.`
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          retryDelays[
            attempt
          ]
        )
    );
  }

  if (!response) {
    throw new Error(
      "Cloudflare não respondeu."
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (
    contentType.includes(
      "image/"
    )
  ) {
    if (!response.ok) {
      throw new Error(
        `Cloudflare respondeu HTTP ${response.status}`
      );
    }

    return Buffer.from(
      await response.arrayBuffer()
    );
  }

  const text =
    await response.text();

  let json:
    unknown = null;

  try {
    json =
      JSON.parse(text);
  } catch {
    // Tratado abaixo.
  }

  if (!response.ok) {
    const message =
      json &&
      typeof json ===
        "object"
        ? JSON.stringify(
            json
          ).slice(
            0,
            1000
          )
        : text.slice(
            0,
            1000
          );

    throw new Error(
      `Cloudflare Workers AI: ${message}`
    );
  }

  const base64 =
    extractBase64(
      json
    );

  if (!base64) {
    throw new Error(
      "Cloudflare não retornou a imagem esperada."
    );
  }

  const clean =
    base64.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      ""
    );

  return Buffer.from(
    clean,
    "base64"
  );
}
