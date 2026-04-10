import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeSearchNovelsResponse,
  decodeGetChapterResponse,
  encodeSearchNovelsRequest,
  encodeGetChapterRequest,
  parseGrpcWebPayload,
  wrapGrpcWebRequest,
} from "../src/wuxiaworld-grpc";

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

function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeStringField(fieldNumber: number, value: string): number[] {
  const payload = [...new TextEncoder().encode(value)];
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeBoolField(fieldNumber: number, value: boolean): number[] {
  return [...encodeTag(fieldNumber, 0), value ? 1 : 0];
}

function encodeIntField(fieldNumber: number, value: number): number[] {
  return [...encodeTag(fieldNumber, 0), ...encodeVarint(value)];
}

function encodeFixed64Field(fieldNumber: number, value: number): number[] {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, true);
  return [...encodeTag(fieldNumber, 1), ...new Uint8Array(buffer)];
}

function encodeMessageField(fieldNumber: number, payload: number[]): number[] {
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(payload.length), ...payload];
}

test("encodeGetChapterRequest writes slug-based chapter lookup", () => {
  const request = encodeGetChapterRequest("martial-world", "mw-chapter-101");
  const decoded = new TextDecoder().decode(request);

  assert.match(decoded, /martial-world/);
  assert.match(decoded, /mw-chapter-101/);
});

test("encodeSearchNovelsRequest writes title, status, sort, and count", () => {
  const request = encodeSearchNovelsRequest({
    title: "martial",
    status: -1,
    sortType: 4,
    sortDirection: 0,
    count: 16,
  });
  const decoded = new TextDecoder().decode(request);

  assert.match(decoded, /martial/);
  assert.equal(request.some((byte) => byte === 0xff), true);
});

test("decodeGetChapterResponse extracts chapter html and neighbors", () => {
  const stringValue = encodeMessageField(1, [...new TextEncoder().encode("<p>Full chapter body.</p>")]);
  const previousChapter = [
    ...encodeIntField(1, 99),
    ...encodeStringField(2, "Chapter 99"),
    ...encodeStringField(3, "mw-chapter-99"),
    ...encodeIntField(17, 99),
  ];
  const nextChapter = [
    ...encodeIntField(1, 101),
    ...encodeStringField(2, "Chapter 101"),
    ...encodeStringField(3, "mw-chapter-101"),
    ...encodeIntField(17, 101),
  ];
  const related = [
    ...encodeMessageField(1, previousChapter),
    ...encodeMessageField(2, nextChapter),
  ];
  const chapter = [
    ...encodeIntField(1, 100),
    ...encodeStringField(2, "Chapter 100"),
    ...encodeStringField(3, "mw-chapter-100"),
    ...encodeMessageField(5, stringValue),
    ...encodeBoolField(8, false),
    ...encodeMessageField(12, related),
    ...encodeIntField(17, 100),
  ];
  const response = Uint8Array.from(encodeMessageField(1, chapter));
  const decoded = decodeGetChapterResponse(response);

  assert.equal(decoded.title, "Chapter 100");
  assert.equal(decoded.slug, "mw-chapter-100");
  assert.equal(decoded.order, 100);
  assert.equal(decoded.html, "<p>Full chapter body.</p>");
  assert.equal(decoded.previousChapter?.slug, "mw-chapter-99");
  assert.equal(decoded.nextChapter?.slug, "mw-chapter-101");
});

test("decodeSearchNovelsResponse extracts catalog items and totals", () => {
  const ratingValue = encodeFixed64Field(1, 0.91);
  const reviewInfo = encodeMessageField(17, encodeMessageField(2, ratingValue));
  const chapterCount = encodeMessageField(3, encodeIntField(1, 321));
  const chapterInfo = encodeMessageField(23, chapterCount);
  const authorName = encodeMessageField(13, encodeStringField(1, "Author Name"));
  const synopsis = encodeMessageField(9, encodeStringField(1, "<p>Alpha synopsis.</p>"));
  const coverUrl = encodeMessageField(10, encodeStringField(1, "https://cdn.example.com/alpha.webp"));
  const novel = [
    ...encodeIntField(1, 42),
    ...encodeStringField(2, "Alpha Novel"),
    ...encodeStringField(3, "alpha-novel"),
    ...encodeIntField(4, 1),
    ...synopsis,
    ...coverUrl,
    ...authorName,
    ...encodeStringField(16, "Fantasy"),
    ...reviewInfo,
    ...chapterInfo,
  ];
  const response = Uint8Array.from([
    ...encodeMessageField(1, novel),
    ...encodeIntField(2, 70),
    ...encodeBoolField(3, true),
  ]);
  const decoded = decodeSearchNovelsResponse(response);

  assert.equal(decoded.total, 70);
  assert.equal(decoded.result, true);
  assert.equal(decoded.items[0]?.id, 42);
  assert.equal(decoded.items[0]?.title, "Alpha Novel");
  assert.equal(decoded.items[0]?.slug, "alpha-novel");
  assert.equal(decoded.items[0]?.author, "Author Name");
  assert.equal(decoded.items[0]?.synopsis, "<p>Alpha synopsis.</p>");
  assert.equal(decoded.items[0]?.coverUrl, "https://cdn.example.com/alpha.webp");
  assert.equal(decoded.items[0]?.chapterCount, 321);
  assert.equal(decoded.items[0]?.rating, 0.91);
  assert.deepEqual(decoded.items[0]?.genres, ["Fantasy"]);
});

test("parseGrpcWebPayload reads data frames and trailers", () => {
  const message = Uint8Array.from([10, 0]);
  const requestFrame = wrapGrpcWebRequest(message);
  const trailerText = "grpc-status: 0\r\ngrpc-message: ok\r\n";
  const trailerBytes = new TextEncoder().encode(trailerText);
  const trailerFrame = new Uint8Array(5 + trailerBytes.length);

  trailerFrame[0] = 0x80;
  trailerFrame[1] = (trailerBytes.length >>> 24) & 0xff;
  trailerFrame[2] = (trailerBytes.length >>> 16) & 0xff;
  trailerFrame[3] = (trailerBytes.length >>> 8) & 0xff;
  trailerFrame[4] = trailerBytes.length & 0xff;
  trailerFrame.set(trailerBytes, 5);

  const combined = new Uint8Array(requestFrame.length + trailerFrame.length);
  combined.set(requestFrame, 0);
  combined.set(trailerFrame, requestFrame.length);

  const parsed = parseGrpcWebPayload(combined);
  assert.deepEqual(parsed.message, message);
  assert.equal(parsed.trailers.get("grpc-status"), "0");
  assert.equal(parsed.trailers.get("grpc-message"), "ok");
});
