import test from "node:test";
import assert from "node:assert/strict";

import { chapterHtmlToText } from "../src/render";

test("chapterHtmlToText keeps readable paragraphs and image placeholders", () => {
  const output = chapterHtmlToText(`
    <html>
      <body>
        <h1>Chapter 12</h1>
        <p>Hello <strong>world</strong>.</p>
        <p>Line one<br/>Line two</p>
        <ul>
          <li>First point</li>
          <li>Second point</li>
        </ul>
        <hr />
        <img alt="Map of the sect" src="map.jpg" />
      </body>
    </html>
  `);

  assert.match(output, /# Chapter 12/);
  assert.match(output, /Hello world\./);
  assert.match(output, /Line one\nLine two/);
  assert.match(output, /- First point/);
  assert.match(output, /\*\*\*/);
  assert.match(output, /\[Image: Map of the sect\]/);
});
