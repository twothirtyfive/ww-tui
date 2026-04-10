# WuxiaWorld TUI

A terminal-native WuxiaWorld reader that logs into the site, fetches live chapter data, and keeps your own local reading workflow on top.

It saves a reusable authenticated session locally, lets you open novels or chapters by slug or URL, navigates with live previous and next chapter data, and keeps local-only notes, bookmarks, and Markdown exports.

## Unofficial Client Notice

- This project is unofficial and is not affiliated with, endorsed by, or supported by WuxiaWorld.
- It uses WuxiaWorld's live website and authenticated APIs with your own account. It may stop working at any time if their auth flow, page structure, or API behavior changes.
- Use it only with an account you control. Do not use it to bypass access controls, redistribute paid content, mirror chapters, or automate scraping.
- If a chapter is locked for your account, the TUI is expected to fail or show teaser-only access rather than work around that restriction.

## What works

- Log in through the WuxiaWorld identity form from inside the TUI
- Save your authenticated session locally so you do not need to log in every run
- Search the live novels catalog, sort results, and browse a right-side preview with metadata and synopsis before opening
- Open a novel by slug or full URL
- Open a chapter by slug or full URL
- Read live chapter content in paged or scroll mode
- Fail clearly when WuxiaWorld only returns teaser access, instead of showing a truncated chapter ending in `...`
- Move with `n` and `p` using the site's own chapter links
- Shrink the side panes automatically once a novel is open so the reading area gets most of the screen
- Toggle a zen mode for full-width reading
- Cycle reader themes and text-size presets
- Keep text color independent from theme changes, and cycle it separately inside the reader
- Switch between paged reading and scroll reading, with page turns that naturally flow into the next chapter
- Tune line width, line gap, paragraph gap, paragraph indent, and justification from inside the reader
- Use smarter prose formatting with centered scene breaks, note callouts, and cleaner chapter text flow
- Keep local bookmarks, notes, and per-novel progress
- Reopen to your last novel, chapter, and reading position automatically
- Export your notes and bookmarks to Markdown
- Persist recent novels and discovered chapter links between sessions

## Current limitations

- The left pane is a local recent-novels list, not your full WuxiaWorld account library yet
- The chapter pane fills from the chapters you open and the previous or next links the site exposes, so it is a known-chapters view rather than a perfect full index
- If a chapter is still locked for your account, WuxiaWorld may return teaser-only access; the TUI now tells you to log in or unlock the chapter instead of pretending the teaser is complete
- This is a live client for a third-party service, so auth and parsing can break when WuxiaWorld changes their implementation

## Requirements

- Node.js `18+`
- A terminal with support for interactive full-screen applications
- A WuxiaWorld account you own if you want authenticated chapter access

## Install

```bash
npm install
npm run build
```

## Run

```bash
npm start
```

If you want the `wuxiaworld-tui` command directly:

```bash
npm install -g .
wuxiaworld-tui
```

For development:

```bash
npm run dev
```

## Build a standalone binary

```bash
npm install
npm run build:binary
```

That writes a current-platform executable into `release/`, named like `wuxiaworld-tui-darwin-arm64`.

Each target OS and CPU architecture needs its own binary build.

## Releases

- GitHub release builds are produced from tags matching `v*`.
- Each release job builds a platform-specific standalone binary and publishes a matching `.sha256` checksum file.
- Private signing keys are not stored in this repository.

## Local data and privacy

- Session, state, and exports live under `~/.wuxiaworld-tui` by default.
- Set `WUXIAWORLD_TUI_HOME` to move that directory somewhere else.
- On POSIX systems, the app writes its local storage with owner-only permissions to reduce accidental exposure of tokens, notes, and reading history.
- Logging out with `u` removes the saved session file, but local state and exported Markdown remain until you delete them.

## Controls

- `l`: log in and save a session
- `u`: clear the saved session
- `f`: search and sort novels from the live catalog
  The results browser shows a live preview pane with metadata and synopsis for the currently highlighted novel.
- `o`: open a novel by slug or URL
- `g`: open a chapter by slug or URL
- `t`: cycle reader theme
- `c`: cycle text color
- `m`: toggle paged or scroll mode
- `s`: cycle text size
- `w`: cycle line width
- `L`: cycle line gap
- `P`: cycle paragraph gap
- `i`: toggle paragraph indent
- `J`: toggle justification
- `z`: toggle zen mode
- `tab`: cycle focus between recent novels, known chapters, and reader
- `enter`: open the selected novel or chapter
- `j` / `k`: previous / next page in paged mode, or normal reader movement in scroll mode
- arrow keys, `space`, `pageup` / `pagedown`: also turn pages in paged mode
- `n` / `p`: move to the next or previous chapter
- `b`: add a bookmark at the current chapter position
- `B`: browse bookmarks for the current novel
- `a`: add a note at the current chapter position
- `A`: browse notes for the current novel
- `x`: export bookmarks and notes to Markdown
- `r`: refresh the current chapter from the site
- `?`: help
- `q`: quit

## Development

```bash
npm run build
npm run build:binary
npm test
```
