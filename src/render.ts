import { load } from "cheerio";

function squashInlineWhitespace(text: string): string {
  return text.replace(/[ \t\f\v]+/g, " ");
}

function normalizeBlock(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n\n` : "";
}

function renderNode(node: any): string {
  if (node.type === "text") {
    return squashInlineWhitespace(node.data ?? "");
  }

  if (node.type !== "tag") {
    return (node.children ?? []).map(renderNode).join("");
  }

  const tagName = String(node.name ?? "").toLowerCase();
  const childrenText = (node.children ?? []).map(renderNode).join("");

  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "hr") {
    return "***\n\n";
  }

  if (tagName === "img") {
    const alt = squashInlineWhitespace(node.attribs?.alt ?? "").trim();
    return alt ? `[Image: ${alt}]\n\n` : "[Image]\n\n";
  }

  if (tagName === "li") {
    const line = childrenText.replace(/\n+/g, " ").trim();
    return line ? `- ${line}\n` : "";
  }

  if (tagName === "blockquote") {
    const lines = childrenText
      .trim()
      .split("\n")
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => `> ${line}`)
      .join("\n");

    return lines ? `${lines}\n\n` : "";
  }

  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName.slice(1));
    return normalizeBlock(`${"#".repeat(level)} ${childrenText.trim()}`);
  }

  if (
    [
      "p",
      "div",
      "section",
      "article",
      "aside",
      "header",
      "footer",
      "main",
      "figure",
      "figcaption",
      "tr",
      "table",
      "ul",
      "ol",
      "pre",
    ].includes(tagName)
  ) {
    return normalizeBlock(childrenText);
  }

  return childrenText;
}

export function chapterHtmlToText(html: string): string {
  const $ = load(html);
  $("script,style,noscript,head").remove();

  const rootNode = $("body").get(0) ?? $.root().get(0);
  const rawText = (rootNode?.children ?? []).map(renderNode).join("");

  return rawText
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
