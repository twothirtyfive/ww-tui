import type {
  ReaderLineSpacing,
  ReaderLineWidth,
  ReaderParagraphSpacing,
  ReaderPreferences,
  ReaderTextScale,
} from "./types";

interface ScaleSpec {
  margin: number;
  widthFactor: number;
  indentWidth: number;
}

const SCALE_SPECS: Record<ReaderTextScale, ScaleSpec> = {
  compact: {
    margin: 0,
    widthFactor: 1.06,
    indentWidth: 2,
  },
  comfortable: {
    margin: 1,
    widthFactor: 1,
    indentWidth: 3,
  },
  large: {
    margin: 2,
    widthFactor: 0.92,
    indentWidth: 4,
  },
};

const LINE_WIDTH_RATIOS: Record<ReaderLineWidth, number> = {
  wide: 1,
  balanced: 0.88,
  narrow: 0.76,
};

const LINE_BREAKS: Record<ReaderLineSpacing, number> = {
  tight: 1,
  normal: 1,
  relaxed: 2,
};

const PARAGRAPH_BREAKS: Record<ReaderParagraphSpacing, number> = {
  tight: 1,
  normal: 2,
  relaxed: 3,
};

function normalizeInlineWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isSceneBreak(text: string): boolean {
  const normalized = normalizeInlineWhitespace(text);
  return (
    /^(?:[*#=_~-]\s*){3,}$/.test(normalized) ||
    /^(?:[.·•]\s*){3,}$/.test(normalized)
  );
}

function isNoteParagraph(text: string): boolean {
  return /^(?:tl\s*note|translator'?s?\s*note|author'?s?\s*note|a\/n|note)\s*:/i.test(text.trim());
}

function wrapWords(text: string, width: number, firstPrefix = "", nextPrefix = firstPrefix): string[] {
  const normalized = normalizeInlineWhitespace(text);
  if (!normalized) {
    return [firstPrefix.trimEnd()];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = firstPrefix;

  for (const word of words) {
    const spacer = currentLine.trim().length > 0 ? " " : "";
    const candidate = `${currentLine}${spacer}${word}`;

    if (candidate.length <= width || currentLine.trim().length === 0) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine.trimEnd());
    currentLine = `${nextPrefix}${word}`;
  }

  lines.push(currentLine.trimEnd());
  return lines;
}

function justifyLine(line: string, width: number): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length >= width || !trimmed.includes(" ")) {
    return line.trimEnd();
  }

  const words = trimmed.split(/\s+/);
  if (words.length < 2) {
    return line.trimEnd();
  }

  const baseLength = words.reduce((sum, word) => sum + word.length, 0);
  const gapCount = words.length - 1;
  const totalSpacesNeeded = width - baseLength;
  if (totalSpacesNeeded <= gapCount) {
    return line.trimEnd();
  }

  const evenGap = Math.floor(totalSpacesNeeded / gapCount);
  const remainder = totalSpacesNeeded % gapCount;
  let output = "";

  for (let index = 0; index < words.length; index += 1) {
    output += words[index];
    if (index < gapCount) {
      output += " ".repeat(evenGap + (index < remainder ? 1 : 0));
    }
  }

  return output.trimEnd();
}

function centerText(text: string, width: number): string {
  if (text.length >= width) {
    return text;
  }

  const leftPadding = Math.floor((width - text.length) / 2);
  return `${" ".repeat(leftPadding)}${text}`;
}

function wrapDecoratedLine(line: string, width: number): string[] {
  const trimmed = line.trim();
  if (!trimmed) {
    return [""];
  }

  if (isSceneBreak(trimmed)) {
    return [centerText("* * *", width)];
  }

  const headingMatch = trimmed.match(/^(#+\s+)/);
  if (headingMatch) {
    return wrapWords(trimmed.slice(headingMatch[0].length), width, headingMatch[0], " ".repeat(headingMatch[0].length));
  }

  if (trimmed.startsWith("- ")) {
    return wrapWords(trimmed.slice(2), width, "- ", "  ");
  }

  if (trimmed.startsWith("> ")) {
    return wrapWords(trimmed.slice(2), width, "> ", "  ");
  }

  return wrapWords(trimmed, width);
}

function formatParagraphLines(
  paragraph: string,
  wrapWidth: number,
  preferences: ReaderPreferences,
  scale: ScaleSpec,
): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) {
    return [];
  }

  if (isSceneBreak(trimmed)) {
    return [centerText("* * *", wrapWidth)];
  }

  if (isNoteParagraph(trimmed)) {
    return wrapDecoratedLine(`> ${trimmed}`, wrapWidth);
  }

  const paragraphLines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const output: string[] = [];

  for (let index = 0; index < paragraphLines.length; index += 1) {
    const line = paragraphLines[index];
    const isDecorated =
      /^#+\s+/.test(line) || line.startsWith("- ") || line.startsWith("> ") || isSceneBreak(line);

    if (isDecorated) {
      output.push(...wrapDecoratedLine(line, wrapWidth));
      continue;
    }

    const firstPrefix =
      preferences.paragraphIndent && index === 0 ? " ".repeat(scale.indentWidth) : "";
    let wrappedLines = wrapWords(line, wrapWidth, firstPrefix, "");

    if (preferences.justify) {
      wrappedLines = wrappedLines.map((wrappedLine, wrappedIndex) =>
        wrappedIndex < wrappedLines.length - 1 ? justifyLine(wrappedLine, wrapWidth) : wrappedLine.trimEnd(),
      );
    }

    output.push(...wrappedLines);
  }

  return output;
}

type ReaderFormattingPreferences = Pick<
  ReaderPreferences,
  | "textScale"
  | "readerMode"
  | "lineWidth"
  | "lineSpacing"
  | "paragraphSpacing"
  | "paragraphIndent"
  | "justify"
>;

function paragraphBlocks(
  text: string,
  preferences: ReaderFormattingPreferences,
  availableWidth: number,
): string[][] {
  const scale = SCALE_SPECS[preferences.textScale];
  const wrapWidth = Math.max(
    24,
    Math.floor(availableWidth * LINE_WIDTH_RATIOS[preferences.lineWidth] * scale.widthFactor) - scale.margin * 2,
  );
  const normalized = text.replace(/\r/g, "").trim();

  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);

  return paragraphs.map((paragraph) =>
    formatParagraphLines(paragraph, wrapWidth, preferences as ReaderPreferences, scale).map((line) =>
      `${" ".repeat(scale.margin)}${line}`.trimEnd(),
    ),
  );
}

export function formatReaderText(
  text: string,
  preferences: ReaderFormattingPreferences,
  availableWidth: number,
): string {
  const paragraphSeparator = "\n".repeat(PARAGRAPH_BREAKS[preferences.paragraphSpacing]);
  const lineSeparator = "\n".repeat(LINE_BREAKS[preferences.lineSpacing]);
  const blocks = paragraphBlocks(text, preferences, availableWidth);

  if (blocks.length === 0) {
    return "";
  }

  return blocks.map((lines) => lines.join(lineSeparator)).join(paragraphSeparator);
}

export function paginateReaderText(
  text: string,
  preferences: ReaderFormattingPreferences,
  availableWidth: number,
  linesPerPage: number,
): string[] {
  const pageHeight = Math.max(1, linesPerPage);
  const paragraphGap = Math.max(0, PARAGRAPH_BREAKS[preferences.paragraphSpacing] - 1);
  const lineGap = Math.max(0, LINE_BREAKS[preferences.lineSpacing] - 1);
  const blocks = paragraphBlocks(text, preferences, availableWidth);

  if (blocks.length === 0) {
    return [""];
  }

  const pages: string[] = [];
  let currentPage: string[] = [];
  let currentHeight = 0;

  const pushPage = (): void => {
    pages.push(currentPage.join("\n"));
    currentPage = [];
    currentHeight = 0;
  };

  const appendLines = (lines: string[], gapBefore = 0): void => {
    for (let index = 0; index < gapBefore; index += 1) {
      currentPage.push("");
      currentHeight += 1;
    }

    for (let index = 0; index < lines.length; index += 1) {
      if (index > 0) {
        for (let gapIndex = 0; gapIndex < lineGap; gapIndex += 1) {
          currentPage.push("");
          currentHeight += 1;
        }
      }

      currentPage.push(lines[index]);
      currentHeight += 1;
    }
  };

  for (const block of blocks) {
    let remainingLines = [...block];

    while (remainingLines.length > 0) {
      const gapBefore = currentHeight === 0 ? 0 : paragraphGap;
      const requiredHeight =
        gapBefore +
        remainingLines.length +
        Math.max(0, remainingLines.length - 1) * lineGap;

      if (currentHeight > 0 && currentHeight + requiredHeight <= pageHeight) {
        appendLines(remainingLines, gapBefore);
        remainingLines = [];
        continue;
      }

      if (currentHeight === 0 && requiredHeight <= pageHeight) {
        appendLines(remainingLines);
        remainingLines = [];
        continue;
      }

      if (currentHeight > 0) {
        pushPage();
        continue;
      }

      const availableLineSlots = Math.max(1, Math.floor((pageHeight + lineGap) / (1 + lineGap)));
      appendLines(remainingLines.splice(0, availableLineSlots));
      pushPage();
    }
  }

  if (currentPage.length > 0 || pages.length === 0) {
    pushPage();
  }

  return pages;
}
