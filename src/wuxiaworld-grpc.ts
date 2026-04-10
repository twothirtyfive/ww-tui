const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export interface GrpcChapterReference {
  entityId?: number;
  slug?: string;
  title?: string;
  order?: number;
}

export interface GrpcChapterPayload extends GrpcChapterReference {
  html?: string;
  isTeaser: boolean;
  previousChapter?: GrpcChapterReference;
  nextChapter?: GrpcChapterReference;
}

export interface GrpcWebPayload {
  message?: Uint8Array;
  trailers: Map<string, string>;
}

export interface GrpcNovelSearchItem {
  id: number;
  title: string;
  slug: string;
  status: number;
  author?: string;
  language?: string;
  synopsis?: string;
  coverUrl?: string;
  genres: string[];
  chapterCount?: number;
  rating?: number;
  isSneakPeek: boolean;
  trendingScore?: number;
}

export interface GrpcNovelSearchResponse {
  items: GrpcNovelSearchItem[];
  total: number;
  result: boolean;
}

export interface GrpcSearchNovelsRequest {
  title?: string;
  status: number;
  sortType: number;
  sortDirection: number;
  searchAfterId?: number;
  count: number;
}

interface BinaryCursor {
  bytes: Uint8Array;
  offset: number;
}

function ensureAvailable(cursor: BinaryCursor, length: number): void {
  if (cursor.offset + length > cursor.bytes.length) {
    throw new Error("Encountered a truncated protobuf message.");
  }
}

function readVarint(cursor: BinaryCursor): number {
  let result = 0;
  let shift = 0;

  while (shift < 35) {
    ensureAvailable(cursor, 1);
    const byte = cursor.bytes[cursor.offset];
    cursor.offset += 1;
    result |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return result >>> 0;
    }

    shift += 7;
  }

  throw new Error("Encountered an unsupported protobuf varint.");
}

function readLengthDelimited(cursor: BinaryCursor): Uint8Array {
  const length = readVarint(cursor);
  ensureAvailable(cursor, length);
  const start = cursor.offset;
  cursor.offset += length;
  return cursor.bytes.subarray(start, start + length);
}

function readString(cursor: BinaryCursor): string {
  return textDecoder.decode(readLengthDelimited(cursor));
}

function readBool(cursor: BinaryCursor): boolean {
  return readVarint(cursor) !== 0;
}

function readDouble(cursor: BinaryCursor): number {
  ensureAvailable(cursor, 8);
  const view = new DataView(cursor.bytes.buffer, cursor.bytes.byteOffset + cursor.offset, 8);
  const value = view.getFloat64(0, true);
  cursor.offset += 8;
  return value;
}

function skipField(cursor: BinaryCursor, wireType: number): void {
  switch (wireType) {
    case 0:
      readVarint(cursor);
      return;
    case 1:
      ensureAvailable(cursor, 8);
      cursor.offset += 8;
      return;
    case 2: {
      const length = readVarint(cursor);
      ensureAvailable(cursor, length);
      cursor.offset += length;
      return;
    }
    case 5:
      ensureAvailable(cursor, 4);
      cursor.offset += 4;
      return;
    default:
      throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }
}

function decodeStringValue(bytes: Uint8Array): string | undefined {
  const cursor: BinaryCursor = { bytes, offset: 0 };

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNumber === 1 && wireType === 2) {
      return readString(cursor);
    }

    skipField(cursor, wireType);
  }

  return undefined;
}

function decodeInt32Value(bytes: Uint8Array): number | undefined {
  const cursor: BinaryCursor = { bytes, offset: 0 };

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNumber === 1 && wireType === 0) {
      return readVarint(cursor);
    }

    skipField(cursor, wireType);
  }

  return undefined;
}

function decodeDoubleValue(bytes: Uint8Array): number | undefined {
  const cursor: BinaryCursor = { bytes, offset: 0 };

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNumber === 1 && wireType === 1) {
      return readDouble(cursor);
    }

    skipField(cursor, wireType);
  }

  return undefined;
}

function decodeChapterReference(bytes: Uint8Array): GrpcChapterReference {
  const cursor: BinaryCursor = { bytes, offset: 0 };
  const chapter: GrpcChapterReference = {};

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    switch (fieldNumber) {
      case 1:
        chapter.entityId = readVarint(cursor);
        break;
      case 2:
        chapter.title = readString(cursor);
        break;
      case 3:
        chapter.slug = readString(cursor);
        break;
      case 17:
        chapter.order = readVarint(cursor);
        break;
      default:
        skipField(cursor, wireType);
        break;
    }
  }

  return chapter;
}

function decodeRelatedChapterInfo(bytes: Uint8Array): Pick<GrpcChapterPayload, "previousChapter" | "nextChapter"> {
  const cursor: BinaryCursor = { bytes, offset: 0 };
  const related: Pick<GrpcChapterPayload, "previousChapter" | "nextChapter"> = {};

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType !== 2) {
      skipField(cursor, wireType);
      continue;
    }

    if (fieldNumber === 1) {
      related.previousChapter = decodeChapterReference(readLengthDelimited(cursor));
      continue;
    }

    if (fieldNumber === 2) {
      related.nextChapter = decodeChapterReference(readLengthDelimited(cursor));
      continue;
    }

    skipField(cursor, wireType);
  }

  return related;
}

function decodeChapterItem(bytes: Uint8Array): GrpcChapterPayload {
  const cursor: BinaryCursor = { bytes, offset: 0 };
  const chapter: GrpcChapterPayload = {
    isTeaser: false,
  };

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    switch (fieldNumber) {
      case 1:
        chapter.entityId = readVarint(cursor);
        break;
      case 2:
        chapter.title = readString(cursor);
        break;
      case 3:
        chapter.slug = readString(cursor);
        break;
      case 5:
        if (wireType === 2) {
          chapter.html = decodeStringValue(readLengthDelimited(cursor));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 8:
        chapter.isTeaser = readBool(cursor);
        break;
      case 12:
        if (wireType === 2) {
          Object.assign(chapter, decodeRelatedChapterInfo(readLengthDelimited(cursor)));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 17:
        chapter.order = readVarint(cursor);
        break;
      default:
        skipField(cursor, wireType);
        break;
    }
  }

  return chapter;
}

function decodeNovelReviewInfo(bytes: Uint8Array): Pick<GrpcNovelSearchItem, "rating"> {
  const cursor: BinaryCursor = { bytes, offset: 0 };
  let rating: number | undefined;

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNumber === 2 && wireType === 2) {
      rating = decodeDoubleValue(readLengthDelimited(cursor));
      continue;
    }

    skipField(cursor, wireType);
  }

  return { rating };
}

function decodeNovelChapterInfo(bytes: Uint8Array): Pick<GrpcNovelSearchItem, "chapterCount"> {
  const cursor: BinaryCursor = { bytes, offset: 0 };
  let chapterCount: number | undefined;

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNumber === 3 && wireType === 2) {
      chapterCount = decodeInt32Value(readLengthDelimited(cursor));
      continue;
    }

    skipField(cursor, wireType);
  }

  return { chapterCount };
}

function decodeNovelItem(bytes: Uint8Array): GrpcNovelSearchItem {
  const cursor: BinaryCursor = { bytes, offset: 0 };
  const novel: GrpcNovelSearchItem = {
    id: 0,
    title: "",
    slug: "",
    status: 0,
    genres: [],
    isSneakPeek: false,
  };

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    switch (fieldNumber) {
      case 1:
        novel.id = readVarint(cursor);
        break;
      case 2:
        novel.title = readString(cursor);
        break;
      case 3:
        novel.slug = readString(cursor);
        break;
      case 4:
        novel.status = readVarint(cursor);
        break;
      case 6:
        if (wireType === 2) {
          novel.language = decodeStringValue(readLengthDelimited(cursor));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 9:
        if (wireType === 2) {
          novel.synopsis = decodeStringValue(readLengthDelimited(cursor));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 10:
        if (wireType === 2) {
          novel.coverUrl = decodeStringValue(readLengthDelimited(cursor));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 13:
        if (wireType === 2) {
          novel.author = decodeStringValue(readLengthDelimited(cursor));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 16:
        novel.genres.push(readString(cursor));
        break;
      case 17:
        if (wireType === 2) {
          Object.assign(novel, decodeNovelReviewInfo(readLengthDelimited(cursor)));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 18:
        novel.isSneakPeek = readBool(cursor);
        break;
      case 23:
        if (wireType === 2) {
          Object.assign(novel, decodeNovelChapterInfo(readLengthDelimited(cursor)));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 28:
        if (wireType === 1) {
          novel.trendingScore = readDouble(cursor);
        } else {
          skipField(cursor, wireType);
        }
        break;
      default:
        skipField(cursor, wireType);
        break;
    }
  }

  return novel;
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value >>> 0;

  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }

  bytes.push(remaining);
  return bytes;
}

function encodeSignedVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = BigInt.asUintN(64, BigInt(value));

  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }

  bytes.push(Number(remaining));
  return bytes;
}

function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeStringField(fieldNumber: number, value: string): number[] {
  const payload = [...textEncoder.encode(value)];
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeMessageField(fieldNumber: number, payload: number[]): number[] {
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeInt32Field(fieldNumber: number, value: number): number[] {
  return [...encodeTag(fieldNumber, 0), ...encodeSignedVarint(value)];
}

function encodeStringValueField(fieldNumber: number, value: string): number[] {
  return encodeMessageField(fieldNumber, encodeStringField(1, value));
}

function encodeInt32ValueField(fieldNumber: number, value: number): number[] {
  return encodeMessageField(fieldNumber, encodeInt32Field(1, value));
}

function decodeGrpcTrailers(payload: Uint8Array): Map<string, string> {
  const trailers = new Map<string, string>();
  const lines = textDecoder.decode(payload).split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    const rawValue = line.slice(separator + 1).trim();
    let value = rawValue;

    if (key === "grpc-message") {
      try {
        value = decodeURIComponent(rawValue);
      } catch {
        value = rawValue;
      }
    }

    trailers.set(key, value);
  }

  return trailers;
}

export function encodeGetChapterRequest(novelSlug: string, chapterSlug: string): Uint8Array {
  const slugs = [
    ...encodeStringField(1, novelSlug),
    ...encodeStringField(2, chapterSlug),
  ];
  const property = encodeMessageField(2, slugs);
  const request = encodeMessageField(1, property);
  return Uint8Array.from(request);
}

export function encodeSearchNovelsRequest(request: GrpcSearchNovelsRequest): Uint8Array {
  const payload: number[] = [];

  if (request.title) {
    payload.push(...encodeStringValueField(1, request.title));
  }

  payload.push(...encodeInt32Field(3, request.status));
  payload.push(...encodeInt32Field(4, request.sortType));
  payload.push(...encodeInt32Field(5, request.sortDirection));

  if (typeof request.searchAfterId === "number") {
    payload.push(...encodeInt32ValueField(6, request.searchAfterId));
  }

  payload.push(...encodeInt32Field(7, request.count));
  return Uint8Array.from(payload);
}

export function wrapGrpcWebRequest(message: Uint8Array): Uint8Array {
  const framed = new Uint8Array(5 + message.length);
  framed[0] = 0;
  const length = message.length;
  framed[1] = (length >>> 24) & 0xff;
  framed[2] = (length >>> 16) & 0xff;
  framed[3] = (length >>> 8) & 0xff;
  framed[4] = length & 0xff;
  framed.set(message, 5);
  return framed;
}

export function parseGrpcWebPayload(bytes: Uint8Array): GrpcWebPayload {
  const trailers = new Map<string, string>();
  let message: Uint8Array | undefined;
  let offset = 0;

  while (offset < bytes.length) {
    if (offset + 5 > bytes.length) {
      throw new Error("Encountered a truncated gRPC-web frame.");
    }

    const flag = bytes[offset];
    const length =
      (bytes[offset + 1] << 24) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 8) |
      bytes[offset + 4];
    offset += 5;

    if (length < 0 || offset + length > bytes.length) {
      throw new Error("Encountered an invalid gRPC-web frame length.");
    }

    const payload = bytes.subarray(offset, offset + length);
    offset += length;

    if ((flag & 0x80) === 0x80) {
      for (const [key, value] of decodeGrpcTrailers(payload).entries()) {
        trailers.set(key, value);
      }
      continue;
    }

    if (!message) {
      message = payload;
    }
  }

  return { message, trailers };
}

export function decodeGetChapterResponse(bytes: Uint8Array): GrpcChapterPayload {
  const cursor: BinaryCursor = { bytes, offset: 0 };

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNumber === 1 && wireType === 2) {
      return decodeChapterItem(readLengthDelimited(cursor));
    }

    skipField(cursor, wireType);
  }

  throw new Error("The chapter API returned an empty response.");
}

export function decodeSearchNovelsResponse(bytes: Uint8Array): GrpcNovelSearchResponse {
  const cursor: BinaryCursor = { bytes, offset: 0 };
  const response: GrpcNovelSearchResponse = {
    items: [],
    total: 0,
    result: false,
  };

  while (cursor.offset < cursor.bytes.length) {
    const tag = readVarint(cursor);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    switch (fieldNumber) {
      case 1:
        if (wireType === 2) {
          response.items.push(decodeNovelItem(readLengthDelimited(cursor)));
        } else {
          skipField(cursor, wireType);
        }
        break;
      case 2:
        response.total = readVarint(cursor);
        break;
      case 3:
        response.result = readBool(cursor);
        break;
      default:
        skipField(cursor, wireType);
        break;
    }
  }

  return response;
}
