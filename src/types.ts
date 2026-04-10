export interface ChapterSummary {
  id: string;
  title: string;
  order: number;
  slug?: string;
  url?: string;
}

export interface ChapterContent {
  title: string;
  text: string;
}

export interface Bookmark {
  id: string;
  label: string;
  chapterIndex: number;
  chapterId?: string;
  chapterLabel?: string;
  scrollPercent: number;
  createdAt: string;
}

export interface Annotation {
  id: string;
  note: string;
  chapterIndex: number;
  chapterId?: string;
  chapterLabel?: string;
  scrollPercent: number;
  createdAt: string;
}

export interface ReaderProgress {
  currentChapter: number;
  currentChapterId?: string;
  scrollPercent: number;
  bookmarks: Bookmark[];
  annotations: Annotation[];
}

export type ReaderThemeId = "paper" | "midnight" | "forest" | "amber";
export type ReaderTextScale = "compact" | "comfortable" | "large";
export type ReaderLineWidth = "wide" | "balanced" | "narrow";
export type ReaderLineSpacing = "tight" | "normal" | "relaxed";
export type ReaderParagraphSpacing = "tight" | "normal" | "relaxed";
export type ReaderTextColor = "black" | "white" | "brightwhite" | "gray" | "green" | "yellow" | "cyan";
export type ReaderMode = "paged" | "scroll";

export interface ReaderPreferences {
  theme: ReaderThemeId;
  textColor: ReaderTextColor;
  textScale: ReaderTextScale;
  readerMode: ReaderMode;
  zenMode: boolean;
  lineWidth: ReaderLineWidth;
  lineSpacing: ReaderLineSpacing;
  paragraphSpacing: ReaderParagraphSpacing;
  paragraphIndent: boolean;
  justify: boolean;
}

export interface RecentNovel {
  id: string;
  slug: string;
  title: string;
  author?: string;
  firstChapter?: ChapterSummary;
  latestChapter?: ChapterSummary;
  knownChapters?: ChapterSummary[];
  currentChapterId?: string;
  currentChapterTitle?: string;
  updatedAt: string;
}

export interface ReaderState {
  lastOpenedBookId?: string;
  books: Record<string, ReaderProgress>;
  recentNovels?: RecentNovel[];
  preferences?: ReaderPreferences;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
