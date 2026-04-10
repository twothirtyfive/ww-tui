import path from "node:path";

import { ensurePrivateDirectory, writePrivateTextFile } from "./storage";
import type { Annotation, Bookmark, ChapterSummary, ReaderProgress } from "./types";

function sanitizeFileName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+/g, "")
      .replace(/-+$/g, "") || "notebook"
  );
}

function chapterName(
  chapters: ChapterSummary[],
  reference: Pick<Bookmark | Annotation, "chapterId" | "chapterIndex" | "chapterLabel">,
): string {
  if (reference.chapterLabel) {
    return reference.chapterLabel;
  }

  if (reference.chapterId) {
    const chapterById = chapters.find((chapter) => chapter.id === reference.chapterId);
    if (chapterById) {
      return chapterById.title;
    }
  }

  return chapters[reference.chapterIndex]?.title || `Chapter ${reference.chapterIndex + 1}`;
}

export function exportNotebook(
  appHome: string,
  title: string,
  author: string | undefined,
  progress: ReaderProgress,
  chapters: ChapterSummary[],
): string {
  const exportDir = path.join(appHome, "exports");
  ensurePrivateDirectory(exportDir);

  const filePath = path.join(exportDir, `${sanitizeFileName(title)}.md`);
  const lines: string[] = [];

  lines.push(`# ${title}`);

  if (author) {
    lines.push("");
    lines.push(`Author: ${author}`);
  }

  lines.push("");
  lines.push(
    `Current chapter: ${chapterName(chapters, {
      chapterId: progress.currentChapterId,
      chapterIndex: progress.currentChapter,
      chapterLabel: chapters[progress.currentChapter]?.title,
    })}`,
  );
  lines.push(`Current position: ${progress.scrollPercent}%`);
  lines.push("");
  lines.push("## Bookmarks");
  lines.push("");

  if (progress.bookmarks.length === 0) {
    lines.push("No bookmarks yet.");
  } else {
    for (const bookmark of progress.bookmarks) {
      lines.push(
        `- ${bookmark.label} (${chapterName(chapters, bookmark)} @ ${bookmark.scrollPercent}%)`,
      );
    }
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");

  if (progress.annotations.length === 0) {
    lines.push("No notes yet.");
  } else {
    for (const annotation of progress.annotations) {
      lines.push(`### ${chapterName(chapters, annotation)} @ ${annotation.scrollPercent}%`);
      lines.push("");
      lines.push(annotation.note);
      lines.push("");
    }
  }

  writePrivateTextFile(filePath, `${lines.join("\n").trim()}\n`);
  return filePath;
}
