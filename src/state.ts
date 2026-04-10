import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { resolveAppHome } from "./paths";
import { ensurePrivateDirectory, writePrivateTextFile } from "./storage";
import type { ReaderPreferences, ReaderProgress, ReaderState, ReaderTextColor, ReaderThemeId } from "./types";

function inferReaderTextColor(theme: ReaderThemeId | undefined): ReaderTextColor {
  switch (theme) {
    case "midnight":
      return "white";
    case "forest":
      return "green";
    case "amber":
      return "yellow";
    case "paper":
    default:
      return "black";
  }
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "paper",
  textColor: "black",
  textScale: "comfortable",
  readerMode: "paged",
  zenMode: false,
  lineWidth: "balanced",
  lineSpacing: "normal",
  paragraphSpacing: "normal",
  paragraphIndent: false,
  justify: false,
};

const DEFAULT_STATE: ReaderState = {
  books: {},
  recentNovels: [],
  preferences: DEFAULT_READER_PREFERENCES,
};

export function createDefaultProgress(): ReaderProgress {
  return {
    currentChapter: 0,
    scrollPercent: 0,
    bookmarks: [],
    annotations: [],
  };
}

export class StateStore {
  readonly homeDir: string;
  readonly stateFilePath: string;

  constructor(homeDir = resolveAppHome()) {
    this.homeDir = homeDir;
    this.stateFilePath = path.join(this.homeDir, "state.json");
  }

  load(): ReaderState {
    if (!existsSync(this.stateFilePath)) {
      return structuredClone(DEFAULT_STATE);
    }

    try {
      const rawState = readFileSync(this.stateFilePath, "utf8");
      const parsed = JSON.parse(rawState) as ReaderState;
      const parsedPreferences: Partial<ReaderPreferences> = parsed.preferences ?? {};
      const theme = parsedPreferences.theme ?? DEFAULT_READER_PREFERENCES.theme;
      const textColor = parsedPreferences.textColor ?? inferReaderTextColor(theme);

      return {
        lastOpenedBookId: parsed.lastOpenedBookId,
        books: parsed.books ?? {},
        recentNovels: parsed.recentNovels ?? [],
        preferences: {
          ...DEFAULT_READER_PREFERENCES,
          ...parsedPreferences,
          textColor,
        },
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  save(state: ReaderState): void {
    ensurePrivateDirectory(this.homeDir);
    writePrivateTextFile(this.stateFilePath, JSON.stringify(state, null, 2));
  }

  ensureProgress(state: ReaderState, bookId: string): ReaderProgress {
    if (!state.books[bookId]) {
      state.books[bookId] = createDefaultProgress();
    }

    return state.books[bookId];
  }
}
