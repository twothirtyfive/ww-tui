import test from "node:test";
import assert from "node:assert/strict";

import { extractReactQueryState, parseNovelInput } from "../src/wuxiaworld";

test("extractReactQueryState parses embedded query state with undefined values", () => {
  const html = `
    <html>
      <body>
        <script>
          window.__REACT_QUERY_STATE__ = {"queries":[{"queryKey":["novel","my-novel",undefined],"state":{"data":{"item":{"slug":"my-novel"}}}}]};
        </script>
      </body>
    </html>
  `;

  const state = extractReactQueryState(html);
  assert.equal(state.queries?.[0]?.queryKey?.[0], "novel");
  assert.equal(state.queries?.[0]?.queryKey?.[2], null);
});

test("parseNovelInput accepts raw slugs and chapter URLs", () => {
  assert.deepEqual(parseNovelInput("martial-world"), {
    novelSlug: "martial-world",
  });

  assert.deepEqual(
    parseNovelInput("https://www.wuxiaworld.com/novel/martial-world/mw-chapter-101"),
    {
      novelSlug: "martial-world",
      chapterSlug: "mw-chapter-101",
    },
  );
});
