import test from "node:test";
import assert from "node:assert/strict";

import { formatReaderText, paginateReaderText } from "../src/reader-format";
import { DEFAULT_READER_PREFERENCES } from "../src/state";

test("formatReaderText adds more breathing room for larger text sizes", () => {
  const sample = [
    "The mountain path narrowed as he climbed toward the monastery.",
    "",
    "The lantern swayed against the wind and painted the stones gold.",
  ].join("\n");

  const compact = formatReaderText(
    sample,
    {
      ...DEFAULT_READER_PREFERENCES,
      textScale: "compact",
    },
    60,
  );
  const large = formatReaderText(
    sample,
    {
      ...DEFAULT_READER_PREFERENCES,
      textScale: "large",
      paragraphSpacing: "relaxed",
    },
    60,
  );

  assert.ok(compact.includes("\n\n"));
  assert.ok(large.includes("\n\n\n"));
  assert.ok(large.split("\n")[0].startsWith("  "));
});

test("formatReaderText supports indent, justification, and scene breaks", () => {
  const sample = [
    "He stepped into the rain and listened for pursuit among the pines.",
    "",
    "***",
    "",
    "TL Note: The sect title here is an honorific rather than a family name.",
  ].join("\n");

  const formatted = formatReaderText(
    sample,
    {
      ...DEFAULT_READER_PREFERENCES,
      paragraphIndent: true,
      justify: true,
      lineWidth: "narrow",
    },
    50,
  );

  assert.match(formatted, /^\s+He\s+stepped/m);
  assert.match(formatted, /\* \* \*/);
  assert.match(formatted, />\s+TL Note:/);
});

test("paginateReaderText splits long chapters into screen-sized pages", () => {
  const sample = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1} carries the scene forward.`).join("\n\n");

  const pages = paginateReaderText(
    sample,
    {
      ...DEFAULT_READER_PREFERENCES,
      readerMode: "paged",
      lineSpacing: "tight",
      paragraphSpacing: "tight",
    },
    48,
    6,
  );

  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.split("\n").length <= 6));
});
