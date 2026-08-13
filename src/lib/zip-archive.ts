import { Buffer } from "node:buffer";

export type ZipEntry = {
  name: string;
  data: Uint8Array | string;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value =
        value & 1
          ? 0xedb88320 ^ (value >>> 1)
          : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc =
      CRC_TABLE[(crc ^ byte) & 0xff] ^
      (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function safeZipName(value: string) {
  const normalized = value
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");

  if (!normalized || normalized.includes("\0")) {
    throw new Error("Nome de arquivo inválido para ZIP.");
  }

  return normalized;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return {
    dosTime,
    dosDate,
  };
}

function uint32(value: number) {
  if (value < 0 || value > 0xffffffff) {
    throw new Error("ZIP excede o limite de 4 GB.");
  }

  return value >>> 0;
}

export function buildZipArchive(
  entries: ZipEntry[],
  options: {
    maxBytes?: number;
    now?: Date;
  } = {}
) {
  const maxBytes =
    options.maxBytes ?? 80 * 1024 * 1024;
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let totalPayloadBytes = 0;
  const { dosTime, dosDate } =
    dosDateTime(options.now);

  for (const entry of entries) {
    const name = safeZipName(entry.name);
    const nameBytes = Buffer.from(name, "utf8");
    const data =
      typeof entry.data === "string"
        ? Buffer.from(entry.data, "utf8")
        : Buffer.from(entry.data);

    totalPayloadBytes += data.length;

    if (totalPayloadBytes > maxBytes) {
      throw new Error(
        "O pacote de exportação excede o limite seguro de 80 MB."
      );
    }

    const checksum = crc32(data);
    const size = uint32(data.length);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(
      localHeader,
      nameBytes,
      data
    );

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(uint32(offset), 42);

    centralParts.push(
      centralHeader,
      nameBytes
    );

    offset +=
      localHeader.length +
      nameBytes.length +
      data.length;
  }

  if (entries.length > 0xffff) {
    throw new Error("ZIP possui arquivos demais.");
  }

  const centralDirectory =
    Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(
    uint32(centralDirectory.length),
    12
  );
  end.writeUInt32LE(uint32(offset), 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    end,
  ]);
}
