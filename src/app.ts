import type blessedTypes from "neo-blessed";
import blessed from "./blessed-runtime";
import { exportNotebook } from "./export";
import { formatReaderText, paginateReaderText } from "./reader-format";
import { DEFAULT_READER_PREFERENCES, StateStore } from "./state";
import type {
  Annotation,
  Bookmark,
  ChapterContent,
  ChapterSummary,
  LoginCredentials,
  ReaderLineSpacing,
  ReaderLineWidth,
  ReaderMode,
  ReaderParagraphSpacing,
  ReaderPreferences,
  ReaderState,
  ReaderTextColor,
  RecentNovel,
  ReaderTextScale,
  ReaderThemeId,
} from "./types";
import {
  type RemoteNovelSearchItem,
  type RemoteNovelSearchSort,
  type RemoteNovelSearchStatus,
  WuxiaWorldClient,
} from "./wuxiaworld";

type FocusTarget = "library" | "chapters" | "reader";

interface CachedChapter {
  chapter: ChapterSummary;
  previousChapter?: ChapterSummary;
  nextChapter?: ChapterSummary;
  content: ChapterContent;
}

interface OpenedNovel {
  id: string;
  slug: string;
  title: string;
  author?: string;
  firstChapter?: ChapterSummary;
  latestChapter?: ChapterSummary;
  chapters: ChapterSummary[];
  chapterCache: Map<string, CachedChapter>;
}

interface ReaderThemeDefinition {
  label: string;
  headerBg: string;
  headerFg: string;
  panelBg: string;
  panelFg: string;
  readerBg: string;
  statusBg: string;
  statusFg: string;
  accent: string;
  selectionBg: string;
  selectionFg: string;
}

const HELP_TEXT = [
  "tab     cycle focus",
  "enter   open selected novel or known chapter",
  "f       find novels by search and sort",
  "o       open a novel by slug or URL",
  "g       open a chapter by slug or URL",
  "t       cycle reader theme",
  "c       cycle text color",
  "m       toggle page or scroll mode",
  "s       cycle text size",
  "z       toggle zen mode",
  "l       authenticate and save session",
  "u       clear the saved session",
  "n/p     next or previous chapter",
  "j/k     previous or next page in paged mode",
  "w       cycle line width",
  "L       cycle line gap",
  "P       cycle paragraph gap",
  "i       toggle paragraph indent",
  "J       toggle justification",
  "pgup/dn page turn or half-page scroll",
  "b/B     save or browse bookmarks",
  "a/A     save or browse notes",
  "x       export notes to Markdown",
  "r       refresh the current chapter",
  "q       quit",
].join("\n");

const READER_THEMES: Record<ReaderThemeId, ReaderThemeDefinition> = {
  paper: {
    label: "Paper",
    headerBg: "blue",
    headerFg: "white",
    panelBg: "white",
    panelFg: "black",
    readerBg: "white",
    statusBg: "white",
    statusFg: "black",
    accent: "blue",
    selectionBg: "blue",
    selectionFg: "white",
  },
  midnight: {
    label: "Midnight",
    headerBg: "black",
    headerFg: "white",
    panelBg: "black",
    panelFg: "white",
    readerBg: "black",
    statusBg: "black",
    statusFg: "white",
    accent: "cyan",
    selectionBg: "cyan",
    selectionFg: "black",
  },
  forest: {
    label: "Forest",
    headerBg: "green",
    headerFg: "black",
    panelBg: "black",
    panelFg: "green",
    readerBg: "black",
    statusBg: "black",
    statusFg: "green",
    accent: "green",
    selectionBg: "green",
    selectionFg: "black",
  },
  amber: {
    label: "Amber",
    headerBg: "yellow",
    headerFg: "black",
    panelBg: "black",
    panelFg: "yellow",
    readerBg: "black",
    statusBg: "black",
    statusFg: "yellow",
    accent: "yellow",
    selectionBg: "yellow",
    selectionFg: "black",
  },
};

const TEXT_SCALE_LABELS: Record<ReaderTextScale, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
  large: "Large",
};

const READER_MODE_LABELS: Record<ReaderMode, string> = {
  paged: "Paged",
  scroll: "Scroll",
};

const TEXT_COLOR_LABELS: Record<ReaderTextColor, string> = {
  black: "Black",
  white: "White",
  brightwhite: "Bright White",
  gray: "Gray",
  green: "Green",
  yellow: "Yellow",
  cyan: "Cyan",
};

const LINE_WIDTH_LABELS: Record<ReaderLineWidth, string> = {
  wide: "Wide",
  balanced: "Balanced",
  narrow: "Narrow",
};

const LINE_SPACING_LABELS: Record<ReaderLineSpacing, string> = {
  tight: "Tight",
  normal: "Normal",
  relaxed: "Relaxed",
};

const PARAGRAPH_SPACING_LABELS: Record<ReaderParagraphSpacing, string> = {
  tight: "Tight",
  normal: "Normal",
  relaxed: "Relaxed",
};

const NOVEL_BROWSER_SORTS: Array<{ id: RemoteNovelSearchSort; label: string }> = [
  { id: "new", label: "Newest" },
  { id: "name", label: "Name (A-Z)" },
  { id: "popular", label: "Most Popular" },
  { id: "chapters", label: "Most Chapters" },
  { id: "rating", label: "Highest Rated" },
  { id: "trending", label: "Trending" },
];

const NOVEL_BROWSER_STATUSES: Array<{ id: RemoteNovelSearchStatus; label: string }> = [
  { id: "all", label: "Any Status" },
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
  { id: "hiatus", label: "Hiatus" },
];

const NOVEL_BROWSER_STATUS_LABELS: Record<RemoteNovelSearchStatus, string> = {
  all: "Any",
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "Hiatus",
};

function sortedRecentNovels(state: ReaderState): RecentNovel[] {
  return [...(state.recentNovels ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function mergeChapters(...chapterLists: Array<ChapterSummary[] | ChapterSummary[] | undefined>): ChapterSummary[] {
  const merged = new Map<string, ChapterSummary>();

  for (const chapterList of chapterLists) {
    for (const chapter of chapterList ?? []) {
      if (!chapter?.id) {
        continue;
      }

      const previous = merged.get(chapter.id);
      merged.set(chapter.id, previous ? { ...previous, ...chapter } : chapter);
    }
  }

  return [...merged.values()].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.title.localeCompare(right.title);
  });
}

export class WuxiaWorldApp {
  private readonly store: StateStore;
  private readonly state: ReaderState;
  private readonly client: WuxiaWorldClient;
  private readonly screen: blessedTypes.Widgets.Screen;
  private readonly header: blessedTypes.Widgets.BoxElement;
  private readonly libraryList: blessedTypes.Widgets.ListElement;
  private readonly chapterList: blessedTypes.Widgets.ListElement;
  private readonly reader: blessedTypes.Widgets.BoxElement;
  private readonly statusBar: blessedTypes.Widgets.BoxElement;
  private readonly prompt: blessedTypes.Widgets.PromptElement;
  private readonly message: blessedTypes.Widgets.MessageElement;
  private readonly loading: blessedTypes.Widgets.LoadingElement;

  private focusedPane: FocusTarget = "library";
  private libraryItems: RecentNovel[];
  private currentBookIndex = 0;
  private currentNovel?: OpenedNovel;
  private currentChapterIndex = 0;
  private currentChapter?: CachedChapter;
  private pendingSaveTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private readerLabelText = " Reader ";
  private readerRawText = "";
  private readerPages: string[] = [];
  private currentReaderPage = 0;

  constructor() {
    this.store = new StateStore();
    this.state = this.store.load();
    this.client = new WuxiaWorldClient(this.store.homeDir);
    this.libraryItems = sortedRecentNovels(this.state);

    this.screen = blessed.screen({
      smartCSR: true,
      title: "WuxiaWorld TUI",
      fullUnicode: true,
      dockBorders: true,
    });

    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: {
        fg: "white",
        bg: "blue",
      },
    });

    this.libraryList = blessed.list({
      parent: this.screen,
      top: 1,
      left: 0,
      width: "28%",
      bottom: 2,
      label: " Recent Novels ",
      border: "line",
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: {
          bg: "green",
          fg: "black",
        },
        border: {
          fg: "cyan",
        },
      },
      scrollbar: {
        ch: " ",
      },
    });

    this.chapterList = blessed.list({
      parent: this.screen,
      top: 1,
      left: "28%",
      width: "28%",
      bottom: 2,
      label: " Known Chapters ",
      border: "line",
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: {
          bg: "green",
          fg: "black",
        },
        border: {
          fg: "cyan",
        },
      },
      scrollbar: {
        ch: " ",
      },
    });

    this.reader = blessed.box({
      parent: this.screen,
      top: 1,
      left: "56%",
      width: "44%",
      bottom: 2,
      label: " Reader ",
      border: "line",
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      tags: false,
      scrollbar: {
        ch: " ",
      },
      style: {
        border: {
          fg: "cyan",
        },
      },
    });

    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 2,
      style: {
        fg: "white",
        bg: "black",
      },
    });

    this.prompt = blessed.prompt({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "60%",
      height: "shrink",
      border: "line",
      label: " Input ",
      hidden: true,
    });

    this.message = blessed.message({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "70%",
      height: "shrink",
      border: "line",
      label: " Message ",
      hidden: true,
    });

    this.loading = blessed.loading({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "50%",
      height: "shrink",
      border: "line",
      label: " Loading ",
      hidden: true,
    });

    this.bindKeys();
    this.bindProcessSignals();
    this.applyTheme();
    this.applyLayout();
    this.refreshHeader();
  }

  async start(): Promise<void> {
    this.refreshLibraryList();
    this.refreshChapterList();
    this.focusPane(this.focusedPane);

    if (this.libraryItems.length === 0) {
      this.showWelcome();
      this.screen.render();
      return;
    }

    await this.runTask(async () => {
      await this.openRecentNovelAt(this.findResumeBookIndex(), true);
    });
  }

  private bindKeys(): void {
    this.screen.key(["q", "C-c"], () => {
      this.shutdown();
    });

    this.screen.key(["tab"], () => {
      this.focusPane(this.nextPane());
      this.screen.render();
    });

    this.screen.key(["?"], () => {
      this.message.display(HELP_TEXT, 0, () => {
        this.focusPane(this.focusedPane);
        this.screen.render();
      });
    });

    this.screen.key(["n"], () => {
      void this.runTask(async () => {
        await this.openAdjacentChapter(1);
      });
    });

    this.screen.key(["p"], () => {
      void this.runTask(async () => {
        await this.openAdjacentChapter(-1);
      });
    });

    this.screen.key(["o"], () => {
      this.openNovelPrompt();
    });

    this.screen.key(["f"], () => {
      void this.runTask(async () => {
        await this.browseNovels();
      });
    });

    this.screen.key(["g"], () => {
      this.openChapterPrompt();
    });

    this.screen.key(["t"], () => {
      this.cycleTheme();
    });

    this.screen.key(["c"], () => {
      this.cycleTextColor();
    });

    this.screen.key(["m"], () => {
      this.toggleReaderMode();
    });

    this.screen.key(["s"], () => {
      this.cycleTextScale();
    });

    this.screen.key(["w"], () => {
      this.cycleLineWidth();
    });

    this.screen.key(["L"], () => {
      this.cycleLineSpacing();
    });

    this.screen.key(["P"], () => {
      this.cycleParagraphSpacing();
    });

    this.screen.key(["i"], () => {
      this.toggleParagraphIndent();
    });

    this.screen.key(["J"], () => {
      this.toggleJustification();
    });

    this.screen.key(["z"], () => {
      this.toggleZenMode();
    });

    this.screen.key(["l"], () => {
      void this.runTask(async () => {
        await this.beginLoginFlow();
      });
    });

    this.screen.key(["u"], () => {
      this.client.logout();
      this.refreshHeader();
      this.renderStatus("Saved session cleared.");
      this.screen.render();
    });

    this.screen.key(["r"], () => {
      void this.runTask(async () => {
        await this.refreshCurrentChapter();
      });
    });

    this.screen.key(["b"], () => {
      this.captureBookmark();
    });

    this.screen.key(["B"], () => {
      this.showBookmarks();
    });

    this.screen.key(["a"], () => {
      this.captureAnnotation();
    });

    this.screen.key(["A"], () => {
      this.showAnnotations();
    });

    this.screen.key(["x"], () => {
      this.exportCurrentNotebook();
    });

    this.libraryList.key(["enter"], () => {
      void this.runTask(async () => {
        await this.openRecentNovelAt(this.getSelectedIndex(this.libraryList));
      });
    });

    this.chapterList.key(["enter"], () => {
      void this.runTask(async () => {
        await this.openChapterAt(this.getSelectedIndex(this.chapterList), false);
      });
    });

    this.reader.on("scroll", () => {
      if (this.readerPreferences.readerMode === "scroll") {
        this.persistProgress();
      }
    });

    this.reader.removeAllListeners("wheeldown");
    this.reader.removeAllListeners("wheelup");

    this.reader.on("wheeldown", () => {
      if (this.isPagedMode()) {
        void this.runTask(async () => {
          await this.advanceReader(1);
        });
        return;
      }

      this.scrollReaderBy(this.readerWheelStep());
    });

    this.reader.on("wheelup", () => {
      if (this.isPagedMode()) {
        void this.runTask(async () => {
          await this.advanceReader(-1);
        });
        return;
      }

      this.scrollReaderBy(-this.readerWheelStep());
    });

    this.reader.key(["pageup"], () => {
      if (this.isPagedMode()) {
        void this.runTask(async () => {
          await this.advanceReader(-1);
        });
        return;
      }

      this.scrollReaderBy(-this.readerPageStep());
    });

    this.reader.key(["pagedown"], () => {
      if (this.isPagedMode()) {
        void this.runTask(async () => {
          await this.advanceReader(1);
        });
        return;
      }

      this.scrollReaderBy(this.readerPageStep());
    });

    this.reader.key(["j", "up"], () => {
      if (!this.isPagedMode()) {
        return;
      }

      void this.runTask(async () => {
        await this.advanceReader(-1);
      });
    });

    this.reader.key(["k", "down", "space"], () => {
      if (!this.isPagedMode()) {
        return;
      }

      void this.runTask(async () => {
        await this.advanceReader(1);
      });
    });

    this.screen.on("resize", () => {
      this.applyLayout();
      this.refreshHeader();
      this.refreshReaderView();
      this.renderStatus();
      this.screen.render();
    });
  }

  private bindProcessSignals(): void {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(signal, () => {
        this.shutdown();
      });
    }
  }

  private async runTask(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.renderStatus(message);
      this.screen.render();
    }
  }

  private get readerPreferences(): ReaderPreferences {
    if (!this.state.preferences) {
      this.state.preferences = { ...DEFAULT_READER_PREFERENCES };
    }

    return this.state.preferences;
  }

  private currentTheme(): ReaderThemeDefinition {
    return READER_THEMES[this.readerPreferences.theme] ?? READER_THEMES.paper;
  }

  private isPagedMode(): boolean {
    return this.readerPreferences.readerMode === "paged";
  }

  private visiblePanes(): FocusTarget[] {
    if (this.currentNovel && this.readerPreferences.zenMode) {
      return ["reader"];
    }

    return ["library", "chapters", "reader"];
  }

  private currentLayoutMode(): "browse" | "focused" | "zen" {
    if (!this.currentNovel) {
      return "browse";
    }

    return this.readerPreferences.zenMode ? "zen" : "focused";
  }

  private applyTheme(): void {
    const theme = this.currentTheme();
    const listStyle = {
      fg: theme.panelFg,
      bg: theme.panelBg,
      border: {
        fg: theme.accent,
      },
      selected: {
        bg: theme.selectionBg,
        fg: theme.selectionFg,
      },
    };

    this.header.style.bg = theme.headerBg;
    this.header.style.fg = theme.headerFg;

    this.statusBar.style.bg = theme.statusBg;
    this.statusBar.style.fg = theme.statusFg;

    this.libraryList.style.fg = listStyle.fg;
    this.libraryList.style.bg = listStyle.bg;
    this.libraryList.style.border = listStyle.border;
    this.libraryList.style.selected = listStyle.selected;

    this.chapterList.style.fg = listStyle.fg;
    this.chapterList.style.bg = listStyle.bg;
    this.chapterList.style.border = listStyle.border;
    this.chapterList.style.selected = listStyle.selected;

    this.reader.style.bg = theme.readerBg;
    this.reader.style.fg = this.readerPreferences.textColor;
    this.reader.style.border = {
      fg: theme.accent,
    };

    this.prompt.style = {
      ...this.prompt.style,
      bg: theme.panelBg,
      fg: theme.panelFg,
      border: {
        fg: theme.accent,
      },
    };

    this.message.style = {
      ...this.message.style,
      bg: theme.panelBg,
      fg: theme.panelFg,
      border: {
        fg: theme.accent,
      },
    };

    this.loading.style = {
      ...this.loading.style,
      bg: theme.panelBg,
      fg: theme.panelFg,
      border: {
        fg: theme.accent,
      },
    };
  }

  private applyLayout(): void {
    const layoutMode = this.currentLayoutMode();

    if (layoutMode === "zen") {
      this.libraryList.hide();
      this.chapterList.hide();
      this.reader.left = 0;
      this.reader.width = "100%";
      this.reader.setLabel(this.readerLabelText);

      if (this.focusedPane !== "reader") {
        this.focusPane("reader");
      }

      return;
    }

    this.libraryList.show();
    this.chapterList.show();

    if (layoutMode === "focused") {
      this.libraryList.left = 0;
      this.libraryList.width = "12%";
      this.libraryList.setLabel(" Novels ");

      this.chapterList.left = "12%";
      this.chapterList.width = "16%";
      this.chapterList.setLabel(" Chapters ");

      this.reader.left = "28%";
      this.reader.width = "72%";
    } else {
      this.libraryList.left = 0;
      this.libraryList.width = "28%";
      this.libraryList.setLabel(" Recent Novels ");

      this.chapterList.left = "28%";
      this.chapterList.width = "28%";
      this.chapterList.setLabel(" Known Chapters ");

      this.reader.left = "56%";
      this.reader.width = "44%";
    }
  }

  private readerTextWidth(): number {
    const screenWidth = typeof this.screen.width === "number" ? this.screen.width : 120;
    const layoutMode = this.currentLayoutMode();
    const readerRatio = layoutMode === "browse" ? 0.44 : layoutMode === "focused" ? 0.72 : 1;

    return Math.max(30, Math.floor(screenWidth * readerRatio) - 6);
  }

  private readerPageHeight(): number {
    const height = Number(this.reader.height) || 0;
    const innerHeight = Number(this.reader.iheight) || 0;
    return Math.max(3, height - innerHeight);
  }

  private setReaderBody(label: string, text: string, scrollPercent = 0): void {
    this.readerLabelText = label;
    this.readerRawText = text;
    this.renderReaderBody(scrollPercent);
  }

  private refreshReaderView(): void {
    if (!this.readerRawText) {
      return;
    }

    this.renderReaderBody(this.currentReaderProgressPercent());
  }

  private renderReaderBody(progressPercent = 0): void {
    this.reader.setLabel(this.readerLabelText);

    if (this.isPagedMode()) {
      this.readerPages = paginateReaderText(
        this.readerRawText,
        this.readerPreferences,
        this.readerTextWidth(),
        this.readerPageHeight(),
      );
      this.currentReaderPage = this.pageIndexFromPercent(progressPercent);
      this.reader.setContent(this.currentReaderPageContent());
      this.reader.scrollTo(0);
      return;
    }

    this.readerPages = [];
    this.currentReaderPage = 0;
    this.reader.setContent(formatReaderText(this.readerRawText, this.readerPreferences, this.readerTextWidth()));
    this.reader.setScrollPerc(progressPercent);
  }

  private cycleTheme(): void {
    const themeIds = Object.keys(READER_THEMES) as ReaderThemeId[];
    const currentIndex = themeIds.indexOf(this.readerPreferences.theme);
    this.readerPreferences.theme = themeIds[(currentIndex + 1 + themeIds.length) % themeIds.length];
    this.applyTheme();
    this.refreshHeader();
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(`Theme: ${this.currentTheme().label}`);
    this.screen.render();
  }

  private cycleTextColor(): void {
    const colorIds: ReaderTextColor[] = ["black", "white", "brightwhite", "gray", "green", "yellow", "cyan"];
    const currentIndex = colorIds.indexOf(this.readerPreferences.textColor);
    this.readerPreferences.textColor = colorIds[(currentIndex + 1 + colorIds.length) % colorIds.length];
    this.applyTheme();
    this.store.save(this.state);
    this.renderStatus(`Text color: ${TEXT_COLOR_LABELS[this.readerPreferences.textColor]}`);
    this.screen.render();
  }

  private toggleReaderMode(): void {
    this.readerPreferences.readerMode = this.isPagedMode() ? "scroll" : "paged";
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(`Reader mode: ${READER_MODE_LABELS[this.readerPreferences.readerMode]}`);
    this.screen.render();
  }

  private cycleTextScale(): void {
    const scaleIds: ReaderTextScale[] = ["compact", "comfortable", "large"];
    const currentIndex = scaleIds.indexOf(this.readerPreferences.textScale);
    this.readerPreferences.textScale = scaleIds[(currentIndex + 1 + scaleIds.length) % scaleIds.length];
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(`Text size: ${TEXT_SCALE_LABELS[this.readerPreferences.textScale]}`);
    this.screen.render();
  }

  private cycleLineWidth(): void {
    const widthIds: ReaderLineWidth[] = ["wide", "balanced", "narrow"];
    const currentIndex = widthIds.indexOf(this.readerPreferences.lineWidth);
    this.readerPreferences.lineWidth = widthIds[(currentIndex + 1 + widthIds.length) % widthIds.length];
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(`Line width: ${LINE_WIDTH_LABELS[this.readerPreferences.lineWidth]}`);
    this.screen.render();
  }

  private cycleLineSpacing(): void {
    const spacingIds: ReaderLineSpacing[] = ["tight", "normal", "relaxed"];
    const currentIndex = spacingIds.indexOf(this.readerPreferences.lineSpacing);
    this.readerPreferences.lineSpacing = spacingIds[(currentIndex + 1 + spacingIds.length) % spacingIds.length];
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(`Line gap: ${LINE_SPACING_LABELS[this.readerPreferences.lineSpacing]}`);
    this.screen.render();
  }

  private cycleParagraphSpacing(): void {
    const spacingIds: ReaderParagraphSpacing[] = ["tight", "normal", "relaxed"];
    const currentIndex = spacingIds.indexOf(this.readerPreferences.paragraphSpacing);
    this.readerPreferences.paragraphSpacing =
      spacingIds[(currentIndex + 1 + spacingIds.length) % spacingIds.length];
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(`Paragraph gap: ${PARAGRAPH_SPACING_LABELS[this.readerPreferences.paragraphSpacing]}`);
    this.screen.render();
  }

  private toggleParagraphIndent(): void {
    this.readerPreferences.paragraphIndent = !this.readerPreferences.paragraphIndent;
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(this.readerPreferences.paragraphIndent ? "Paragraph indent enabled." : "Paragraph indent disabled.");
    this.screen.render();
  }

  private toggleJustification(): void {
    this.readerPreferences.justify = !this.readerPreferences.justify;
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(this.readerPreferences.justify ? "Justification enabled." : "Justification disabled.");
    this.screen.render();
  }

  private toggleZenMode(): void {
    if (!this.currentNovel) {
      this.renderStatus("Open a novel first.");
      this.screen.render();
      return;
    }

    this.readerPreferences.zenMode = !this.readerPreferences.zenMode;
    this.applyLayout();
    this.refreshReaderView();
    this.store.save(this.state);
    this.renderStatus(this.readerPreferences.zenMode ? "Zen mode enabled." : "Zen mode disabled.");
    this.screen.render();
  }

  private getSelectedIndex(list: blessedTypes.Widgets.ListElement): number {
    return Number((list as blessedTypes.Widgets.ListElement & { selected?: number }).selected ?? 0);
  }

  private readerVisibleLines(): number {
    const height = Number(this.reader.height) || 0;
    const innerHeight = Number(this.reader.iheight) || 0;
    return Math.max(1, height - innerHeight);
  }

  private readerWheelStep(): number {
    return Math.max(1, Math.floor(this.readerVisibleLines() / 4));
  }

  private readerPageStep(): number {
    return Math.max(1, Math.floor(this.readerVisibleLines() / 2));
  }

  private scrollReaderBy(offset: number): void {
    this.reader.scroll(offset);
    this.screen.render();
  }

  private currentReaderProgressPercent(): number {
    if (this.isPagedMode()) {
      if (this.readerPages.length <= 1) {
        return 0;
      }

      return Math.round((this.currentReaderPage / (this.readerPages.length - 1)) * 100);
    }

    return Math.round(this.reader.getScrollPerc() || 0);
  }

  private pageIndexFromPercent(progressPercent: number): number {
    if (this.readerPages.length <= 1) {
      return 0;
    }

    const clamped = Math.max(0, Math.min(100, progressPercent));
    return Math.max(0, Math.min(this.readerPages.length - 1, Math.round((clamped / 100) * (this.readerPages.length - 1))));
  }

  private currentReaderPageContent(): string {
    return this.readerPages[this.currentReaderPage] ?? "";
  }

  private setCurrentReaderPage(index: number): void {
    this.currentReaderPage = Math.max(0, Math.min(this.readerPages.length - 1, index));
    this.reader.setContent(this.currentReaderPageContent());
    this.reader.scrollTo(0);
    this.persistProgress();
    this.screen.render();
  }

  private async advanceReader(offset: number): Promise<void> {
    if (!this.currentChapter) {
      return;
    }

    if (!this.isPagedMode()) {
      this.scrollReaderBy(offset > 0 ? this.readerPageStep() : -this.readerPageStep());
      return;
    }

    const nextPage = this.currentReaderPage + offset;
    if (nextPage >= 0 && nextPage < this.readerPages.length) {
      this.setCurrentReaderPage(nextPage);
      return;
    }

    const previousChapterId = this.currentChapter.chapter.id;
    await this.openAdjacentChapter(offset > 0 ? 1 : -1);

    if (!this.currentChapter || this.currentChapter.chapter.id === previousChapterId) {
      return;
    }

    if (offset < 0 && this.readerPages.length > 0) {
      this.setCurrentReaderPage(this.readerPages.length - 1);
    }
  }

  private nextPane(): FocusTarget {
    const panes = this.visiblePanes();
    const currentIndex = panes.indexOf(this.focusedPane);
    return panes[(currentIndex + 1 + panes.length) % panes.length];
  }

  private focusPane(target: FocusTarget): void {
    const panes = this.visiblePanes();
    this.focusedPane = panes.includes(target) ? target : panes[0];

    if (this.focusedPane === "library") {
      this.libraryList.focus();
    } else if (this.focusedPane === "chapters") {
      this.chapterList.focus();
    } else {
      this.reader.focus();
    }

    this.renderStatus();
  }

  private refreshHeader(): void {
    const sessionLabel = this.client.hasSession() ? "authenticated" : "guest";
    const title = this.currentNovel ? `${this.currentNovel.title}` : "Remote Reader";
    const theme = this.currentTheme();
    this.header.setContent(
      `{bold}WuxiaWorld TUI{/bold}  ${title}  [{yellow-fg}${sessionLabel}{/yellow-fg}]  ${theme.label}`,
    );
  }

  private refreshRecentNovels(): void {
    this.libraryItems = sortedRecentNovels(this.state);
  }

  private refreshLibraryList(): void {
    this.refreshRecentNovels();

    const items =
      this.libraryItems.length > 0
        ? this.libraryItems.map((item) =>
            item.currentChapterTitle ? `${item.title}  -  ${item.currentChapterTitle}` : item.title,
          )
        : ["No recent novels yet"];

    this.libraryList.setItems(items);
    if (this.libraryItems.length > 0) {
      this.libraryList.select(Math.min(this.currentBookIndex, this.libraryItems.length - 1));
    }
  }

  private refreshChapterList(): void {
    const items =
      this.currentNovel?.chapters.map((chapter, index) => `${index + 1}. ${chapter.title}`) ?? [
        "Open a novel to see known chapters",
      ];

    this.chapterList.setItems(items);
    if (this.currentNovel && this.currentNovel.chapters.length > 0) {
      this.chapterList.select(Math.min(this.currentChapterIndex, this.currentNovel.chapters.length - 1));
    }
  }

  private showWelcome(message?: string): void {
    this.currentNovel = undefined;
    this.currentChapter = undefined;
    this.readerPages = [];
    this.currentReaderPage = 0;
    this.readerPreferences.zenMode = false;
    this.applyLayout();
    this.setReaderBody(
      " Reader ",
      [
        message,
        "Read live WuxiaWorld chapters in your terminal.",
        "",
        "Suggested flow:",
        "1. Press l to authenticate and save your session.",
        "2. Press f to search and sort the novels catalog, or press o to paste a slug or URL.",
        "3. Use n and p to move across chapters.",
        "4. Quit anytime and it will resume this chapter and position on launch.",
        "",
        "Extra reader controls:",
        "- t cycles themes",
        "- c changes text color",
        "- m toggles paged and scroll mode",
        "- s changes text size",
        "- w changes line width",
        "- L changes line gap",
        "- P changes paragraph gap",
        "- i toggles paragraph indent",
        "- J toggles justification",
        "- z opens zen mode",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    this.refreshHeader();
    this.renderStatus(message);
  }

  private findResumeBookIndex(): number {
    if (!this.state.lastOpenedBookId) {
      return 0;
    }

    const index = this.libraryItems.findIndex((item) => item.id === this.state.lastOpenedBookId);
    return index >= 0 ? index : 0;
  }

  private currentProgress() {
    if (!this.currentNovel) {
      return undefined;
    }

    return this.store.ensureProgress(this.state, this.currentNovel.id);
  }

  private updateRecentNovel(currentChapter?: ChapterSummary): void {
    if (!this.currentNovel) {
      return;
    }

    const record: RecentNovel = {
      id: this.currentNovel.id,
      slug: this.currentNovel.slug,
      title: this.currentNovel.title,
      author: this.currentNovel.author,
      firstChapter: this.currentNovel.firstChapter,
      latestChapter: this.currentNovel.latestChapter,
      knownChapters: this.currentNovel.chapters,
      currentChapterId: currentChapter?.id ?? this.currentChapter?.chapter.id,
      currentChapterTitle: currentChapter?.title ?? this.currentChapter?.chapter.title,
      updatedAt: new Date().toISOString(),
    };

    const recentNovels = (this.state.recentNovels ?? []).filter((item) => item.id !== record.id);
    recentNovels.unshift(record);
    this.state.recentNovels = recentNovels.slice(0, 40);
    this.state.lastOpenedBookId = record.id;

    this.refreshLibraryList();
    this.currentBookIndex = this.libraryItems.findIndex((item) => item.id === record.id);
    if (this.currentBookIndex >= 0) {
      this.libraryList.select(this.currentBookIndex);
    }
  }

  private chapterIndexFromEntry(entry: Pick<Bookmark | Annotation, "chapterId" | "chapterIndex">): number {
    if (!this.currentNovel) {
      return entry.chapterIndex;
    }

    if (entry.chapterId) {
      const index = this.currentNovel.chapters.findIndex((chapter) => chapter.id === entry.chapterId);
      if (index >= 0) {
        return index;
      }
    }

    return entry.chapterIndex;
  }

  private chapterTitleFromEntry(
    entry: Pick<Bookmark | Annotation, "chapterId" | "chapterIndex" | "chapterLabel">,
  ): string {
    if (entry.chapterLabel) {
      return entry.chapterLabel;
    }

    if (this.currentNovel?.chapters.length) {
      const index = this.chapterIndexFromEntry(entry);
      return this.currentNovel.chapters[index]?.title ?? `Chapter ${index + 1}`;
    }

    return `Chapter ${entry.chapterIndex + 1}`;
  }

  private ensureKnownChapters(...chapters: Array<ChapterSummary | undefined>): void {
    if (!this.currentNovel) {
      return;
    }

    this.currentNovel.chapters = mergeChapters(this.currentNovel.chapters, chapters.filter(Boolean) as ChapterSummary[]);
    this.refreshChapterList();
    this.updateRecentNovel();
  }

  private setCurrentNovel(novel: {
    id: string;
    slug: string;
    title: string;
    author?: string;
    firstChapter?: ChapterSummary;
    latestChapter?: ChapterSummary;
    chapters: ChapterSummary[];
  }): void {
    const savedNovel = this.state.recentNovels?.find((item) => item.id === novel.id);

    this.currentNovel = {
      id: novel.id,
      slug: novel.slug,
      title: novel.title,
      author: novel.author,
      firstChapter: novel.firstChapter,
      latestChapter: novel.latestChapter,
      chapters: mergeChapters(
        savedNovel?.knownChapters ?? [],
        novel.chapters,
        [novel.firstChapter, novel.latestChapter].filter(Boolean) as ChapterSummary[],
      ),
      chapterCache: new Map<string, CachedChapter>(),
    };
    this.readerPages = [];
    this.currentReaderPage = 0;

    this.applyLayout();
    this.refreshHeader();
    this.refreshChapterList();
    this.updateRecentNovel();
  }

  private async openRecentNovelAt(index: number, announceResume = false): Promise<void> {
    const selectedNovel = this.libraryItems[index];
    if (!selectedNovel) {
      return;
    }

    this.currentBookIndex = index;
    this.libraryList.select(index);

    const remoteNovel = await this.withLoading(`Opening ${selectedNovel.title}...`, async () =>
      this.client.fetchNovel(selectedNovel.slug),
    );

    this.setCurrentNovel(remoteNovel.novel);
    const progress = this.currentProgress();
    const targetChapterId =
      remoteNovel.requestedChapterSlug ??
      progress?.currentChapterId ??
      selectedNovel.currentChapterId ??
      this.currentNovel?.firstChapter?.id ??
      this.currentNovel?.latestChapter?.id ??
      this.currentNovel?.chapters[0]?.id;

    if (!targetChapterId) {
      this.showWelcome(`Opened ${selectedNovel.title}, but no chapters were available.`);
      this.screen.render();
      return;
    }

    await this.openChapterById(targetChapterId, true);

    if (announceResume) {
      this.renderStatus(`Resumed ${selectedNovel.title}.`);
      this.screen.render();
    }
  }

  private async openNovelByInput(input: string): Promise<void> {
    const remoteNovel = await this.withLoading("Opening novel...", async () => this.client.fetchNovel(input));
    this.setCurrentNovel(remoteNovel.novel);

    const progress = this.currentProgress();
    const targetChapterId =
      remoteNovel.requestedChapterSlug ??
      progress?.currentChapterId ??
      this.currentNovel?.firstChapter?.id ??
      this.currentNovel?.latestChapter?.id ??
      this.currentNovel?.chapters[0]?.id;

    if (!targetChapterId) {
      this.showWelcome(`Opened ${remoteNovel.novel.title}, but no chapters were available.`);
      this.screen.render();
      return;
    }

    await this.openChapterById(targetChapterId, true);
  }

  private async openChapterAt(index: number, restoreScroll: boolean): Promise<void> {
    if (!this.currentNovel) {
      return;
    }

    const chapter = this.currentNovel.chapters[index];
    if (!chapter) {
      return;
    }

    await this.openChapterById(chapter.id, restoreScroll);
  }

  private async openChapterById(chapterId: string, restoreScroll: boolean): Promise<void> {
    if (!this.currentNovel) {
      return;
    }

    const cachedChapter = this.currentNovel.chapterCache.get(chapterId);
    const progress = this.currentProgress();
    const shouldRestoreScroll = restoreScroll && progress?.currentChapterId === chapterId;

    const chapterData =
      cachedChapter ??
      (await this.withLoading(`Loading ${chapterId}...`, async () => {
        const result = await this.client.fetchChapter(this.currentNovel?.slug ?? "", chapterId);
        const discoveredChapter: CachedChapter = {
          chapter: result.chapter,
          previousChapter: result.previousChapter,
          nextChapter: result.nextChapter,
          content: result.content,
        };
        this.currentNovel?.chapterCache.set(result.chapter.id, discoveredChapter);
        return discoveredChapter;
      }));

    this.currentChapter = chapterData;
    this.ensureKnownChapters(chapterData.chapter, chapterData.previousChapter, chapterData.nextChapter);

    const chapterIndex = this.currentNovel.chapters.findIndex((chapter) => chapter.id === chapterData.chapter.id);
    this.currentChapterIndex = chapterIndex >= 0 ? chapterIndex : 0;

    this.chapterList.select(this.currentChapterIndex);
    this.setReaderBody(
      ` Reader - ${chapterData.content.title} `,
      chapterData.content.text,
      shouldRestoreScroll ? progress?.scrollPercent ?? 0 : 0,
    );

    this.persistProgress();
    this.renderStatus();
    this.screen.render();
  }

  private async openAdjacentChapter(offset: number): Promise<void> {
    if (!this.currentNovel || !this.currentChapter) {
      return;
    }

    const candidate =
      offset > 0 ? this.currentChapter.nextChapter : this.currentChapter.previousChapter;

    if (candidate) {
      await this.openChapterById(candidate.id, false);
      return;
    }

    const nextIndex = this.currentChapterIndex + offset;
    if (nextIndex < 0 || nextIndex >= this.currentNovel.chapters.length) {
      this.renderStatus("No more chapters in that direction.");
      this.screen.render();
      return;
    }

    await this.openChapterAt(nextIndex, false);
  }

  private async refreshCurrentChapter(): Promise<void> {
    if (!this.currentNovel || !this.currentChapter) {
      return;
    }

    this.currentNovel.chapterCache.delete(this.currentChapter.chapter.id);
    await this.openChapterById(this.currentChapter.chapter.id, false);
  }

  private persistProgress(): void {
    this.captureCurrentProgress();

    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
    }

    this.pendingSaveTimer = setTimeout(() => {
      this.store.save(this.state);
    }, 150);

    this.renderStatus();
  }

  private captureCurrentProgress(): void {
    if (!this.currentNovel) {
      return;
    }

    const progress = this.currentProgress();
    if (!progress) {
      return;
    }

    progress.currentChapter = this.currentChapterIndex;
    progress.currentChapterId = this.currentChapter?.chapter.id;
    progress.scrollPercent = this.currentReaderProgressPercent();
    this.state.lastOpenedBookId = this.currentNovel.id;
    this.updateRecentNovel(this.currentChapter?.chapter);
  }

  private flushState(): void {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = undefined;
    }

    this.captureCurrentProgress();
    this.store.save(this.state);
  }

  private withPrompt(promptText: string, callback: (value: string) => void, initialValue = ""): void {
    void this.promptForValue(promptText, initialValue).then((value) => {
      if (value === undefined) {
        return;
      }

      callback(value);
    });
  }

  private async promptForValue(promptText: string, initialValue = "", allowEmpty = false): Promise<string | undefined> {
    const previousFocus = this.focusedPane;
    return await new Promise<string | undefined>((resolve) => {
      this.prompt.input(promptText, initialValue, (_error, value) => {
        this.focusPane(previousFocus);
        this.screen.render();

        if (typeof value !== "string") {
          resolve(undefined);
          return;
        }

        const trimmedValue = value.trim();
        if (!allowEmpty && !trimmedValue) {
          resolve(undefined);
          return;
        }

        resolve(trimmedValue);
      });
    });
  }

  private async promptForCredentials(): Promise<LoginCredentials | undefined> {
    return await new Promise<LoginCredentials | undefined>((resolve) => {
      const previousFocus = this.focusedPane;
      const modal = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "60%",
        height: 12,
        border: "line",
        label: " WuxiaWorld Login ",
        style: {
          border: {
            fg: "yellow",
          },
        },
      });

      blessed.text({
        parent: modal,
        top: 1,
        left: 2,
        content: "Email",
      });

      const emailInput = blessed.textbox({
        parent: modal,
        top: 2,
        left: 2,
        width: "92%",
        height: 3,
        border: "line",
        inputOnFocus: true,
        keys: true,
      });

      blessed.text({
        parent: modal,
        top: 5,
        left: 2,
        content: "Password",
      });

      const passwordInput = blessed.textbox({
        parent: modal,
        top: 6,
        left: 2,
        width: "92%",
        height: 3,
        border: "line",
        inputOnFocus: true,
        keys: true,
        censor: true,
      });

      blessed.box({
        parent: modal,
        top: 9,
        left: 2,
        width: "92%",
        height: 1,
        content: "tab: next  enter: next or submit  esc: cancel",
        style: {
          fg: "gray",
        },
      });

      const close = (credentials?: LoginCredentials) => {
        modal.destroy();
        this.focusPane(previousFocus);
        this.screen.render();
        resolve(credentials);
      };

      const submit = () => {
        const email = emailInput.getValue().trim();
        const password = passwordInput.getValue();

        if (!email || !password) {
          this.renderStatus("Email and password are both required.");
          this.screen.render();
          return;
        }

        close({ email, password });
      };

      modal.key(["escape"], () => {
        close();
      });

      emailInput.key(["tab", "down"], () => {
        passwordInput.focus();
      });

      passwordInput.key(["S-tab", "up"], () => {
        emailInput.focus();
      });

      emailInput.key(["enter"], () => {
        passwordInput.focus();
      });

      passwordInput.key(["tab", "enter"], () => {
        submit();
      });

      emailInput.focus();
      this.screen.render();
    });
  }

  private async beginLoginFlow(): Promise<void> {
    const credentials = await this.promptForCredentials();
    if (!credentials) {
      return;
    }

    await this.withLoading("Logging in...", async () => {
      await this.client.login(credentials);
    });

    this.refreshHeader();
    this.renderStatus("Authenticated session saved locally.");
    this.screen.render();
  }

  private formatNovelBrowserItem(item: RemoteNovelSearchItem): string {
    const details: string[] = [NOVEL_BROWSER_STATUS_LABELS[item.status]];

    if (typeof item.chapterCount === "number") {
      details.push(`${item.chapterCount} ch`);
    }

    if (typeof item.rating === "number") {
      details.push(`${Math.round(item.rating * 100)}%`);
    }

    if (item.genres.length > 0) {
      details.push(item.genres.slice(0, 2).join(", "));
    }

    if (item.isSneakPeek) {
      details.push("Sneak Peek");
    }

    const authorLabel = item.author ? ` - ${item.author}` : "";
    return `${item.title}${authorLabel} [${details.join(" | ")}]`;
  }

  private async browseNovels(): Promise<void> {
    const title = await this.promptForValue("Search novels (blank for all):", "", true);
    if (title === undefined) {
      return;
    }

    const sortIndex = await this.chooseFromList(
      "Sort Novels",
      NOVEL_BROWSER_SORTS.map((sort, index) => `${index + 1}. ${sort.label}`),
    );
    if (sortIndex === undefined) {
      return;
    }

    const statusIndex = await this.chooseFromList(
      "Novel Status",
      NOVEL_BROWSER_STATUSES.map((status, index) => `${index + 1}. ${status.label}`),
    );
    if (statusIndex === undefined) {
      return;
    }

    const selectedSort = NOVEL_BROWSER_SORTS[sortIndex];
    const selectedStatus = NOVEL_BROWSER_STATUSES[statusIndex];
    const results = await this.withLoading(
      title ? `Searching novels for "${title}"...` : "Loading novels...",
      async () =>
        this.client.searchAllNovels({
          title: title || undefined,
          sort: selectedSort.id,
          status: selectedStatus.id,
        }),
    );

    if (results.items.length === 0) {
      this.renderStatus("No novels matched that search.");
      this.screen.render();
      return;
    }

    const selection = await this.chooseNovelFromList(
      `Novels (${results.items.length}/${results.total})`,
      results.items,
    );
    if (selection === undefined) {
      return;
    }

    await this.openNovelByInput(results.items[selection].slug);
  }

  private openNovelPrompt(): void {
    this.withPrompt("Novel slug or URL:", (value) => {
      void this.runTask(async () => {
        await this.openNovelByInput(value);
      });
    });
  }

  private openChapterPrompt(): void {
    if (!this.currentNovel) {
      this.renderStatus("Open a novel first.");
      this.screen.render();
      return;
    }

    this.withPrompt("Chapter slug or URL:", (value) => {
      void this.runTask(async () => {
        await this.openChapterById(value, false);
      });
    });
  }

  private createBookmark(label: string): Bookmark | undefined {
    if (!this.currentNovel || !this.currentChapter) {
      return undefined;
    }

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      chapterIndex: this.currentChapterIndex,
      chapterId: this.currentChapter.chapter.id,
      chapterLabel: this.currentChapter.chapter.title,
      scrollPercent: this.currentReaderProgressPercent(),
      createdAt: new Date().toISOString(),
    };
  }

  private createAnnotation(note: string): Annotation | undefined {
    if (!this.currentNovel || !this.currentChapter) {
      return undefined;
    }

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      note,
      chapterIndex: this.currentChapterIndex,
      chapterId: this.currentChapter.chapter.id,
      chapterLabel: this.currentChapter.chapter.title,
      scrollPercent: this.currentReaderProgressPercent(),
      createdAt: new Date().toISOString(),
    };
  }

  private captureBookmark(): void {
    if (!this.currentNovel) {
      return;
    }

    this.withPrompt("Bookmark label:", (label) => {
      const bookmark = this.createBookmark(label);
      const progress = this.currentProgress();
      if (!bookmark || !progress) {
        return;
      }

      progress.bookmarks.push(bookmark);
      this.store.save(this.state);
      this.renderStatus(`Bookmark saved: ${label}`);
      this.screen.render();
    });
  }

  private captureAnnotation(): void {
    if (!this.currentNovel) {
      return;
    }

    this.withPrompt("Quick note:", (note) => {
      const annotation = this.createAnnotation(note);
      const progress = this.currentProgress();
      if (!annotation || !progress) {
        return;
      }

      progress.annotations.push(annotation);
      this.store.save(this.state);
      this.renderStatus("Note saved.");
      this.screen.render();
    });
  }

  private showSelectionModal(
    title: string,
    items: string[],
    onSelect: (index: number) => void | Promise<void>,
  ): void {
    const previousFocus = this.focusedPane;
    const modal = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "70%",
      height: "70%",
      border: "line",
      label: ` ${title} `,
      style: {
        border: {
          fg: "yellow",
        },
      },
    });

    const list = blessed.list({
      parent: modal,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      keys: true,
      vi: true,
      mouse: true,
      items,
      style: {
        selected: {
          bg: "green",
          fg: "black",
        },
      },
      scrollbar: {
        ch: " ",
      },
    });

    const closeModal = () => {
      modal.destroy();
      this.focusPane(previousFocus);
      this.screen.render();
    };

    list.key(["escape", "q"], () => {
      closeModal();
    });

    list.key(["enter"], () => {
      const selection = this.getSelectedIndex(list);
      closeModal();
      void onSelect(selection);
    });

    list.focus();
    this.screen.render();
  }

  private async chooseFromList(title: string, items: string[]): Promise<number | undefined> {
    const previousFocus = this.focusedPane;

    return await new Promise<number | undefined>((resolve) => {
      const modal = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "70%",
        height: "70%",
        border: "line",
        label: ` ${title} `,
        style: {
          border: {
            fg: "yellow",
          },
        },
      });

      const list = blessed.list({
        parent: modal,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        keys: true,
        vi: true,
        mouse: true,
        items,
        style: {
          selected: {
            bg: "green",
            fg: "black",
          },
        },
        scrollbar: {
          ch: " ",
        },
      });

      const closeModal = (selection?: number) => {
        modal.destroy();
        this.focusPane(previousFocus);
        this.screen.render();
        resolve(selection);
      };

      list.key(["escape", "q"], () => {
        closeModal();
      });

      list.key(["enter"], () => {
        closeModal(this.getSelectedIndex(list));
      });

      list.focus();
      this.screen.render();
    });
  }

  private centeredLine(text: string, width: number): string {
    if (!text) {
      return "";
    }

    if (text.length >= width) {
      return text;
    }

    const padding = Math.max(0, Math.floor((width - text.length) / 2));
    return `${" ".repeat(padding)}${text}`;
  }

  private centerBlock(block: string | undefined, width: number): string {
    if (!block) {
      return "";
    }

    return block
      .split("\n")
      .map((line) => this.centeredLine(line, width))
      .join("\n");
  }

  private wrapText(text: string, width: number): string {
    const wrappedParagraphs = text
      .trim()
      .split(/\n{2,}/)
      .map((paragraph) => {
        const words = paragraph.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
        const lines: string[] = [];
        let currentLine = "";

        for (const word of words) {
          if (!currentLine) {
            currentLine = word;
            continue;
          }

          if (`${currentLine} ${word}`.length <= width) {
            currentLine = `${currentLine} ${word}`;
            continue;
          }

          lines.push(currentLine);
          currentLine = word;
        }

        if (currentLine) {
          lines.push(currentLine);
        }

        return lines.join("\n");
      });

    return wrappedParagraphs.join("\n\n");
  }

  private formatNovelPreviewContent(item: RemoteNovelSearchItem, width: number): string {
    const details: string[] = [NOVEL_BROWSER_STATUS_LABELS[item.status]];

    if (item.language) {
      details.push(item.language);
    }

    if (typeof item.chapterCount === "number") {
      details.push(`${item.chapterCount} chapters`);
    }

    if (typeof item.rating === "number") {
      details.push(`${Math.round(item.rating * 100)}% rating`);
    }

    if (item.isSneakPeek) {
      details.push("Sneak Peek");
    }

    const parts = [
      this.centeredLine(item.title, width),
      item.author ? this.centeredLine(`by ${item.author}`, width) : "",
      "",
      this.wrapText(details.join(" | "), width),
      item.genres.length > 0 ? this.wrapText(item.genres.join(" | "), width) : "",
      "",
      this.wrapText(item.synopsis?.trim() || "No synopsis available for this novel.", width),
      "",
      this.centeredLine("enter opens this novel", width),
    ].filter(Boolean);

    return parts.join("\n");
  }

  private async chooseNovelFromList(
    title: string,
    items: RemoteNovelSearchItem[],
  ): Promise<number | undefined> {
    const previousFocus = this.focusedPane;
    const screenWidth = typeof this.screen.width === "number" ? this.screen.width : 120;
    const previewWidth = Math.max(28, Math.floor(screenWidth * 0.86 * 0.56) - 6);

    return await new Promise<number | undefined>((resolve) => {
      const modal = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "86%",
        height: "78%",
        border: "line",
        label: ` ${title} `,
        style: {
          border: {
            fg: "yellow",
          },
        },
      });

      const list = blessed.list({
        parent: modal,
        top: 0,
        left: 0,
        width: "44%",
        bottom: 0,
        keys: true,
        vi: true,
        mouse: true,
        items: items.map((item) => this.formatNovelBrowserItem(item)),
        style: {
          selected: {
            bg: "green",
            fg: "black",
          },
        },
        scrollbar: {
          ch: " ",
        },
      });

      const preview = blessed.box({
        parent: modal,
        top: 0,
        left: "44%",
        width: "56%",
        bottom: 0,
        label: " Preview ",
        border: "line",
        scrollable: true,
        alwaysScroll: true,
        mouse: true,
        keys: false,
        scrollbar: {
          ch: " ",
        },
      });

      let closed = false;

      const closeModal = (selection?: number) => {
        closed = true;
        modal.destroy();
        this.focusPane(previousFocus);
        this.screen.render();
        resolve(selection);
      };

      const updatePreview = async () => {
        if (closed) {
          return;
        }

        const item = items[this.getSelectedIndex(list)];
        if (!item) {
          return;
        }

        preview.setContent(this.formatNovelPreviewContent(item, previewWidth));
        preview.scrollTo(0);
        this.screen.render();
      };

      list.key(["escape", "q"], () => {
        closeModal();
      });

      list.key(["enter"], () => {
        closeModal(this.getSelectedIndex(list));
      });

      list.on("keypress", () => {
        void updatePreview();
      });
      list.on("click", () => {
        void updatePreview();
      });
      list.on("wheeldown", () => {
        void updatePreview();
      });
      list.on("wheelup", () => {
        void updatePreview();
      });

      list.focus();
      void updatePreview();
      this.screen.render();
    });
  }

  private showBookmarks(): void {
    const progress = this.currentProgress();
    if (!this.currentNovel || !progress || progress.bookmarks.length === 0) {
      this.renderStatus("No bookmarks saved for this novel yet.");
      this.screen.render();
      return;
    }

    const items = progress.bookmarks.map(
      (bookmark, index) =>
        `${index + 1}. ${bookmark.label} (${this.chapterTitleFromEntry(bookmark)} @ ${bookmark.scrollPercent}%)`,
    );

    this.showSelectionModal("Bookmarks", items, async (index) => {
      const selected = progress.bookmarks[index];
      if (!selected) {
        return;
      }

      const targetChapterId =
        selected.chapterId ?? this.currentNovel?.chapters[this.chapterIndexFromEntry(selected)]?.id;
      if (!targetChapterId) {
        return;
      }

      await this.openChapterById(targetChapterId, false);
      this.renderReaderBody(selected.scrollPercent);
      this.persistProgress();
      this.screen.render();
    });
  }

  private showAnnotations(): void {
    const progress = this.currentProgress();
    if (!this.currentNovel || !progress || progress.annotations.length === 0) {
      this.renderStatus("No notes saved for this novel yet.");
      this.screen.render();
      return;
    }

    const items = progress.annotations.map(
      (annotation, index) =>
        `${index + 1}. ${this.chapterTitleFromEntry(annotation)} @ ${annotation.scrollPercent}% - ${annotation.note}`,
    );

    this.showSelectionModal("Notes", items, async (index) => {
      const selected = progress.annotations[index];
      if (!selected) {
        return;
      }

      const targetChapterId =
        selected.chapterId ?? this.currentNovel?.chapters[this.chapterIndexFromEntry(selected)]?.id;
      if (!targetChapterId) {
        return;
      }

      await this.openChapterById(targetChapterId, false);
      this.renderReaderBody(selected.scrollPercent);
      this.persistProgress();
      this.message.display(selected.note, 0, () => {
        this.focusPane("reader");
        this.screen.render();
      });
    });
  }

  private exportCurrentNotebook(): void {
    const progress = this.currentProgress();
    if (!this.currentNovel || !progress) {
      return;
    }

    const exportPath = exportNotebook(
      this.store.homeDir,
      this.currentNovel.title,
      this.currentNovel.author,
      progress,
      this.currentNovel.chapters,
    );

    this.renderStatus(`Exported notebook to ${exportPath}`);
    this.screen.render();
  }

  private renderStatus(message?: string): void {
    const progress = this.currentProgress();
    const chapterCount = this.currentNovel?.chapters.length ?? 0;
    const chapterPosition = this.currentNovel ? `${this.currentChapterIndex + 1}/${chapterCount}` : "-/-";
    const progressPercent = this.currentReaderProgressPercent();
    const bookmarkCount = progress?.bookmarks.length ?? 0;
    const annotationCount = progress?.annotations.length ?? 0;
    const minutesLeft = this.currentChapterMinutesLeft(progressPercent);

    const lineOne =
      `${message ?? ""}`.trim() || this.defaultStatusLine();
    const lineTwo = this.currentNovel
      ? [
          READER_MODE_LABELS[this.readerPreferences.readerMode].toLowerCase(),
          TEXT_SCALE_LABELS[this.readerPreferences.textScale].toLowerCase(),
          TEXT_COLOR_LABELS[this.readerPreferences.textColor].toLowerCase(),
          `${LINE_WIDTH_LABELS[this.readerPreferences.lineWidth].toLowerCase()} width`,
          `chapter ${chapterPosition}`,
          this.isPagedMode()
            ? `page ${this.currentReaderPage + 1}/${Math.max(1, this.readerPages.length)}`
            : `scroll ${progressPercent}%`,
          `${progressPercent}% read`,
          `${minutesLeft} left`,
          `${bookmarkCount} marks`,
          `${annotationCount} notes`,
        ].join(" | ")
      : [
          READER_MODE_LABELS[this.readerPreferences.readerMode].toLowerCase(),
          TEXT_SCALE_LABELS[this.readerPreferences.textScale].toLowerCase(),
          TEXT_COLOR_LABELS[this.readerPreferences.textColor].toLowerCase(),
          `${LINE_WIDTH_LABELS[this.readerPreferences.lineWidth].toLowerCase()} width`,
          `${this.libraryItems.length} recent novels`,
        ].join(" | ");

    this.statusBar.setContent(`${lineOne}\n${lineTwo}`);
  }

  private defaultStatusLine(): string {
    if (!this.currentNovel) {
      return "l:login  f:browse  o:open novel  ?:help  q:quit";
    }

    if (this.isPagedMode()) {
      return "f:browse  o:novel  g:chapter  j/k:page  n/p:chapter  b:mark  a:note  ?:help";
    }

    return "f:browse  o:novel  g:chapter  wheel:scroll  n/p:chapter  b:mark  a:note  ?:help";
  }

  private currentChapterMinutesLeft(scrollPosition: number): string {
    const text = this.currentChapter?.content.text ?? "";
    const wordCount = text.match(/\S+/g)?.length ?? 0;
    if (wordCount === 0) {
      return "-";
    }

    const clampedScroll = Math.max(0, Math.min(100, scrollPosition));
    const remainingWords = Math.round(wordCount * (100 - clampedScroll) / 100);
    if (remainingWords <= 0) {
      return "0m";
    }

    return `${Math.max(1, Math.ceil(remainingWords / 220))}m`;
  }

  private async withLoading<T>(label: string, operation: () => Promise<T>): Promise<T> {
    this.loading.load(label);
    this.screen.render();

    try {
      return await operation();
    } finally {
      this.loading.stop();
      this.screen.render();
    }
  }

  private shutdown(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.flushState();
    this.screen.destroy();
    process.exit(0);
  }
}
