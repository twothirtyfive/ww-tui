import { createHash, randomBytes } from "node:crypto";

import { load } from "cheerio";

import { chapterHtmlToText } from "./render";
import {
  CookieJar,
  SessionStore,
  type StoredAuthSession,
} from "./session";
import type { ChapterContent, ChapterSummary, LoginCredentials } from "./types";
import {
  decodeSearchNovelsResponse,
  encodeSearchNovelsRequest,
  decodeGetChapterResponse,
  encodeGetChapterRequest,
  type GrpcNovelSearchResponse,
  parseGrpcWebPayload,
  wrapGrpcWebRequest,
} from "./wuxiaworld-grpc";

const LOGIN_URL = "https://identity.wuxiaworld.com/Account/Login";
const TOKEN_URL = "https://identity.wuxiaworld.com/connect/token";
const AUTHORIZE_URL = "https://identity.wuxiaworld.com/connect/authorize";
const SITE_ORIGIN = "https://www.wuxiaworld.com";
const GRPC_ORIGIN = "https://api2.wuxiaworld.com";
const GRPC_CLIENT_VERSION = "2.11.01-8b83657b";
const OIDC_CLIENT_ID = "wuxiaworld_spa";
const OIDC_REDIRECT_PATH = "/auth/callback/wuxiaworld";
const OIDC_REDIRECT_URI = `${SITE_ORIGIN}${OIDC_REDIRECT_PATH}`;
const OIDC_SCOPES = "openid profile api email offline_access";
const DEFAULT_RETURN_URL = `${SITE_ORIGIN}/`;
const QUERY_STATE_MARKER = "window.__REACT_QUERY_STATE__ = ";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface QueryState {
  queries?: Array<{
    queryKey?: unknown[];
    state?: {
      data?: Record<string, unknown>;
    };
  }>;
}

interface RemoteNovelItem {
  id: string;
  slug: string;
  title: string;
  author?: string;
  chapters: ChapterSummary[];
  firstChapter?: ChapterSummary;
  latestChapter?: ChapterSummary;
}

export interface RemoteNovel {
  novel: RemoteNovelItem;
  requestedChapterSlug?: string;
}

export interface RemoteChapterResult {
  novelSlug: string;
  chapter: ChapterSummary;
  previousChapter?: ChapterSummary;
  nextChapter?: ChapterSummary;
  content: ChapterContent;
}

export type RemoteNovelSearchSort = "name" | "popular" | "chapters" | "new" | "rating" | "trending";
export type RemoteNovelSearchStatus = "all" | "ongoing" | "completed" | "hiatus";

export interface RemoteNovelSearchOptions {
  title?: string;
  sort: RemoteNovelSearchSort;
  status?: RemoteNovelSearchStatus;
}

export interface RemoteNovelSearchItem {
  id: number;
  slug: string;
  title: string;
  author?: string;
  language?: string;
  synopsis?: string;
  coverUrl?: string;
  status: RemoteNovelSearchStatus;
  genres: string[];
  chapterCount?: number;
  rating?: number;
  isSneakPeek: boolean;
}

export interface RemoteNovelSearchResult {
  items: RemoteNovelSearchItem[];
  total: number;
}

export interface NovelReference {
  novelSlug: string;
  chapterSlug?: string;
}

interface AuthorizationRequest {
  url: URL;
  state: string;
  codeVerifier: string;
}

interface TextResponse {
  text: string;
  url: string;
  status: number;
  headers: Headers;
}

interface RemoteNovelSearchPage extends RemoteNovelSearchResult {
  nextSearchAfterId?: number;
}

function isWordCharacter(character: string | undefined): boolean {
  return typeof character === "string" && /[A-Za-z0-9_$]/.test(character);
}

function replaceUndefinedOutsideStrings(serialized: string): string {
  let output = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < serialized.length; index += 1) {
    const character = serialized[index];

    if (quote) {
      output += character;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }

    if (
      serialized.startsWith("undefined", index) &&
      !isWordCharacter(serialized[index - 1]) &&
      !isWordCharacter(serialized[index + "undefined".length])
    ) {
      output += "null";
      index += "undefined".length - 1;
      continue;
    }

    output += character;
  }

  return output;
}

function extractObjectLiteral(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("Could not find embedded page state.");
  }

  const objectStart = source.indexOf("{", markerIndex + marker.length);
  if (objectStart < 0) {
    throw new Error("Could not find the start of the embedded page state.");
  }

  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(objectStart, index + 1);
      }
    }
  }

  throw new Error("Could not parse the embedded page state.");
}

export function extractReactQueryState(html: string): QueryState {
  const objectLiteral = extractObjectLiteral(html, QUERY_STATE_MARKER);
  const normalized = replaceUndefinedOutsideStrings(objectLiteral);
  return JSON.parse(normalized) as QueryState;
}

function chapterOrder(rawChapter: Record<string, any>): number {
  const offset = rawChapter.offset;
  if (typeof offset === "number") {
    return offset;
  }

  const numericValue = rawChapter.number?.units ?? rawChapter.number?.value;
  return typeof numericValue === "number" ? numericValue : 0;
}

function chapterSummaryFromRaw(
  rawChapter: Record<string, any> | undefined,
  novelSlug: string,
): ChapterSummary | undefined {
  if (!rawChapter?.slug) {
    return undefined;
  }

  return {
    id: String(rawChapter.slug),
    slug: String(rawChapter.slug),
    title: String(rawChapter.name ?? rawChapter.slug).trim() || String(rawChapter.slug),
    order: chapterOrder(rawChapter),
    url: `${SITE_ORIGIN}/novel/${novelSlug}/${rawChapter.slug}`,
  };
}

function normalizeChapterList(chapters: ChapterSummary[]): ChapterSummary[] {
  const byId = new Map<string, ChapterSummary>();

  for (const chapter of chapters) {
    if (!chapter.id) {
      continue;
    }

    const previous = byId.get(chapter.id);
    byId.set(chapter.id, previous ? { ...previous, ...chapter } : chapter);
  }

  return [...byId.values()].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.title.localeCompare(right.title);
  });
}

function rawQueryItem(state: QueryState, queryName: string): Record<string, any> | undefined {
  const query = state.queries?.find((candidate) => candidate.queryKey?.[0] === queryName);
  const data = query?.state?.data ?? {};
  return (data.item as Record<string, any> | undefined) ?? (data as Record<string, any>);
}

function parseNovelItem(state: QueryState): RemoteNovelItem {
  const rawNovel = rawQueryItem(state, "novel");
  if (!rawNovel?.slug) {
    throw new Error("Could not find novel metadata on that page.");
  }

  const novelSlug = String(rawNovel.slug);
  const firstChapter = chapterSummaryFromRaw(rawNovel.chapterInfo?.firstChapter, novelSlug);
  const latestChapter = chapterSummaryFromRaw(rawNovel.chapterInfo?.latestChapter, novelSlug);
  const groupChapters = Array.isArray(rawNovel.chapterInfo?.chapterGroups)
    ? rawNovel.chapterInfo.chapterGroups.flatMap((group: Record<string, any>) =>
        Array.isArray(group.chapterList)
          ? group.chapterList
              .map((rawChapter: Record<string, any>) => chapterSummaryFromRaw(rawChapter, novelSlug))
              .filter(Boolean)
          : [],
      )
    : [];

  const chapters = normalizeChapterList(
    [firstChapter, latestChapter, ...groupChapters].filter(Boolean) as ChapterSummary[],
  );

  return {
    id: novelSlug,
    slug: novelSlug,
    title: String(rawNovel.name ?? novelSlug).trim() || novelSlug,
    author: String(rawNovel.authorName?.value ?? "").trim() || undefined,
    firstChapter,
    latestChapter,
    chapters,
  };
}

function parseChapterResult(state: QueryState): RemoteChapterResult {
  const rawChapter = rawQueryItem(state, "chapter");
  if (!rawChapter?.slug || !rawChapter?.novelInfo?.slug) {
    throw new Error("Could not find chapter data on that page.");
  }

  const novelSlug = String(rawChapter.novelInfo.slug);
  const chapter = chapterSummaryFromRaw(rawChapter, novelSlug);
  if (!chapter) {
    throw new Error("Could not determine the current chapter.");
  }

  const html = String(rawChapter.content?.value ?? "").trim();
  if (!html) {
    throw new Error("Chapter content was not available for this session.");
  }

  return {
    novelSlug,
    chapter,
    previousChapter: chapterSummaryFromRaw(rawChapter.relatedChapterInfo?.previousChapter, novelSlug),
    nextChapter: chapterSummaryFromRaw(rawChapter.relatedChapterInfo?.nextChapter, novelSlug),
    content: {
      title: chapter.title,
      text: chapterHtmlToText(html) || "[Chapter content is empty.]",
    },
  };
}

function looksLikeLoginPage(html: string): boolean {
  return html.includes('action="/Account/Login"') || html.includes("name=\"__RequestVerificationToken\"");
}

function extractLoginError(html: string): string | undefined {
  const $ = load(html);
  const validationMessages = [
    $(".validation-summary-errors").text().trim(),
    $("[data-valmsg-for='Username']").text().trim(),
    $("[data-valmsg-for='Password']").text().trim(),
    $("#ExternalValidationError").text().trim(),
  ].filter(Boolean);

  return validationMessages[0];
}

export function parseNovelInput(input: string): NovelReference {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a WuxiaWorld novel slug or URL.");
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { novelSlug: trimmed.replace(/^\/+|\/+$/g, "") };
  }

  const url = new URL(trimmed);
  const segments = url.pathname.split("/").filter(Boolean);
  const novelIndex = segments.indexOf("novel");
  if (novelIndex < 0 || !segments[novelIndex + 1]) {
    throw new Error("That URL does not look like a WuxiaWorld novel or chapter page.");
  }

  return {
    novelSlug: segments[novelIndex + 1],
    chapterSlug: segments[novelIndex + 2],
  };
}

function base64UrlEncode(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(byteLength = 32): string {
  return base64UrlEncode(randomBytes(byteLength));
}

function createCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
}

function authExpiresSoon(auth: StoredAuthSession | undefined, leewayMs = 60_000): boolean {
  if (!auth?.accessToken || !auth.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(auth.expiresAt);
  if (Number.isNaN(expiresAt)) {
    return true;
  }

  return expiresAt <= Date.now() + leewayMs;
}

function chapterSummaryFromGrpc(
  rawChapter:
    | {
        slug?: string;
        title?: string;
        order?: number;
        entityId?: number;
      }
    | undefined,
  fallbackNovelSlug: string,
): ChapterSummary | undefined {
  if (!rawChapter?.slug) {
    return undefined;
  }

  const id = rawChapter.slug || (rawChapter.entityId ? String(rawChapter.entityId) : "");
  if (!id) {
    return undefined;
  }

  return {
    id,
    slug: rawChapter.slug,
    title: rawChapter.title?.trim() || rawChapter.slug,
    order: rawChapter.order ?? 0,
    url: `${SITE_ORIGIN}/novel/${fallbackNovelSlug}/${rawChapter.slug}`,
  };
}

function grpcSortType(sort: RemoteNovelSearchSort): number {
  switch (sort) {
    case "popular":
      return 1;
    case "new":
      return 2;
    case "chapters":
      return 3;
    case "name":
      return 4;
    case "rating":
      return 6;
    case "trending":
      return 7;
    default:
      return 2;
  }
}

function grpcSortDirection(sort: RemoteNovelSearchSort): number {
  return sort === "name" ? 0 : 1;
}

function grpcStatus(status: RemoteNovelSearchStatus): number {
  switch (status) {
    case "completed":
      return 0;
    case "ongoing":
      return 1;
    case "hiatus":
      return 2;
    case "all":
      return -1;
    default:
      return 1;
  }
}

function remoteNovelStatus(status: number): RemoteNovelSearchStatus {
  switch (status) {
    case 0:
      return "completed";
    case 1:
      return "ongoing";
    case 2:
      return "hiatus";
    default:
      return "ongoing";
  }
}

function mapSearchResults(payload: GrpcNovelSearchResponse): RemoteNovelSearchItem[] {
  return payload.items
    .filter((item) => item.slug && item.title)
    .map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
      author: item.author?.trim() || undefined,
      language: item.language?.trim() || undefined,
      synopsis: item.synopsis ? chapterHtmlToText(item.synopsis) : undefined,
      coverUrl: item.coverUrl?.trim() || undefined,
      status: remoteNovelStatus(item.status),
      genres: item.genres,
      chapterCount: item.chapterCount,
      rating: item.rating,
      isSneakPeek: item.isSneakPeek,
    }));
}

export class WuxiaWorldClient {
  private readonly jar: CookieJar;
  private readonly store: SessionStore;
  private auth?: StoredAuthSession;

  constructor(homeDir?: string) {
    this.store = new SessionStore(homeDir);
    const session = this.store.read();
    this.jar = new CookieJar(session.cookies);
    this.auth = session.auth;
  }

  hasSession(): boolean {
    return Boolean(this.auth?.accessToken || this.auth?.refreshToken);
  }

  logout(): void {
    this.jar.clear();
    this.auth = undefined;
    this.store.clear();
  }

  async login(credentials: LoginCredentials): Promise<void> {
    const { code, codeVerifier } = await this.authorizeWithLogin(credentials);
    await this.exchangeAuthorizationCode(code, codeVerifier);
    this.persistSession();
  }

  async fetchNovel(input: string): Promise<RemoteNovel> {
    const reference = parseNovelInput(input);
    const response = await this.requestText(`${SITE_ORIGIN}/novel/${reference.novelSlug}`);
    const state = extractReactQueryState(response.text);
    const novel = parseNovelItem(state);

    return {
      novel,
      requestedChapterSlug: reference.chapterSlug,
    };
  }

  async fetchChapter(novelSlug: string, chapterInput: string): Promise<RemoteChapterResult> {
    const chapterReference = parseNovelInput(chapterInput);
    const resolvedNovelSlug = chapterReference.chapterSlug ? chapterReference.novelSlug : novelSlug;
    const chapterSlug = chapterReference.chapterSlug ?? chapterReference.novelSlug;
    const chapter = await this.requestGrpcChapter(resolvedNovelSlug, chapterSlug);

    if (chapter.isTeaser) {
      if (this.hasSession()) {
        throw new Error(
          "WuxiaWorld only granted teaser access for this chapter on the saved account. Unlock it there, then refresh here.",
        );
      }

      throw new Error("WuxiaWorld only returned a teaser for this chapter. Press l to log in for full chapter access.");
    }

    if (!chapter.html?.trim()) {
      throw new Error("Chapter content was not available for this session.");
    }

    const currentChapter = chapterSummaryFromGrpc(chapter, resolvedNovelSlug);
    if (!currentChapter) {
      throw new Error("Could not determine the current chapter.");
    }

    return {
      novelSlug: resolvedNovelSlug,
      chapter: currentChapter,
      previousChapter: chapterSummaryFromGrpc(chapter.previousChapter, resolvedNovelSlug),
      nextChapter: chapterSummaryFromGrpc(chapter.nextChapter, resolvedNovelSlug),
      content: {
        title: currentChapter.title,
        text: chapterHtmlToText(chapter.html) || "[Chapter content is empty.]",
      },
    };
  }

  async searchAllNovels(options: RemoteNovelSearchOptions): Promise<RemoteNovelSearchResult> {
    const items: RemoteNovelSearchItem[] = [];
    const seenIds = new Set<number>();
    let nextSearchAfterId: number | undefined;
    let total = 0;

    for (let page = 0; page < 20; page += 1) {
      const response = await this.searchNovelsPage(options, nextSearchAfterId);
      total = response.total;

      for (const item of response.items) {
        if (seenIds.has(item.id)) {
          continue;
        }

        seenIds.add(item.id);
        items.push(item);
      }

      if (!response.nextSearchAfterId || response.items.length === 0 || items.length >= response.total) {
        break;
      }

      nextSearchAfterId = response.nextSearchAfterId;
    }

    return {
      items,
      total,
    };
  }

  private persistSession(): void {
    this.store.save(this.jar.serialize(), this.auth);
  }

  private createAuthorizationRequest(): AuthorizationRequest {
    const codeVerifier = randomBase64Url(48);
    const state = randomBase64Url(24);
    const nonce = randomBase64Url(24);
    const authorizeUrl = new URL(AUTHORIZE_URL);

    authorizeUrl.searchParams.set("client_id", OIDC_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", OIDC_REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("response_mode", "query");
    authorizeUrl.searchParams.set("scope", OIDC_SCOPES);
    authorizeUrl.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("nonce", nonce);

    return {
      url: authorizeUrl,
      state,
      codeVerifier,
    };
  }

  private isOAuthCallbackUrl(url: URL): boolean {
    return url.origin === SITE_ORIGIN && url.pathname === OIDC_REDIRECT_PATH;
  }

  private extractAuthorizationCode(response: TextResponse, state: string): string | undefined {
    const location = response.headers.get("location");
    const callbackUrl = location ? new URL(location, response.url) : new URL(response.url);

    if (!this.isOAuthCallbackUrl(callbackUrl)) {
      return undefined;
    }

    const error = callbackUrl.searchParams.get("error");
    if (error) {
      throw new Error(callbackUrl.searchParams.get("error_description") ?? error);
    }

    if (callbackUrl.searchParams.get("state") !== state) {
      throw new Error("WuxiaWorld returned an unexpected OAuth state.");
    }

    const code = callbackUrl.searchParams.get("code");
    if (!code) {
      throw new Error("WuxiaWorld did not return an authorization code.");
    }

    return code;
  }

  private async authorizeWithLogin(credentials: LoginCredentials): Promise<{ code: string; codeVerifier: string }> {
    const authorization = this.createAuthorizationRequest();

    const authorizationResponse = await this.requestText(authorization.url.toString(), {
      stopRedirect: (nextUrl) => this.isOAuthCallbackUrl(nextUrl),
    });

    const existingSessionCode = this.extractAuthorizationCode(authorizationResponse, authorization.state);
    if (existingSessionCode) {
      return {
        code: existingSessionCode,
        codeVerifier: authorization.codeVerifier,
      };
    }

    if (!looksLikeLoginPage(authorizationResponse.text)) {
      throw new Error("Could not reach the WuxiaWorld login page.");
    }

    const $ = load(authorizationResponse.text);
    const loginForm = $("form[action*='/Account/Login']").first();
    if (loginForm.length === 0) {
      throw new Error("Could not find the WuxiaWorld login form.");
    }

    const verificationToken = String(
      loginForm.find("input[name='__RequestVerificationToken']").attr("value") ?? "",
    ).trim();
    if (!verificationToken) {
      throw new Error("Could not find the anti-forgery token on the login page.");
    }

    const action = loginForm.attr("action") ?? LOGIN_URL;
    const actionUrl = new URL(action, authorizationResponse.url).toString();
    const returnUrl =
      String(loginForm.find("input[name='ReturnUrl']").attr("value") ?? "").trim() || DEFAULT_RETURN_URL;

    const body = new URLSearchParams({
      ReturnUrl: returnUrl,
      Username: credentials.email,
      Password: credentials.password,
      button: "login",
      __RequestVerificationToken: verificationToken,
    });

    const loginResponse = await this.requestText(actionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      referer: authorizationResponse.url,
      stopRedirect: (nextUrl) => this.isOAuthCallbackUrl(nextUrl),
    });

    const code = this.extractAuthorizationCode(loginResponse, authorization.state);
    if (code) {
      return {
        code,
        codeVerifier: authorization.codeVerifier,
      };
    }

    if (looksLikeLoginPage(loginResponse.text)) {
      throw new Error(extractLoginError(loginResponse.text) ?? "WuxiaWorld rejected the login attempt.");
    }

    throw new Error("Could not capture the WuxiaWorld authorization redirect after login.");
  }

  private async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<void> {
    const response = await this.requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: OIDC_CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        redirect_uri: OIDC_REDIRECT_URI,
      }),
    );

    this.saveTokenResponse(response);
  }

  private saveTokenResponse(response: TokenResponse): void {
    if (!response.access_token) {
      throw new Error("WuxiaWorld did not return an access token.");
    }

    const expiresAt =
      typeof response.expires_in === "number"
        ? new Date(Date.now() + response.expires_in * 1000).toISOString()
        : this.auth?.expiresAt;

    this.auth = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? this.auth?.refreshToken,
      idToken: response.id_token ?? this.auth?.idToken,
      tokenType: response.token_type ?? this.auth?.tokenType ?? "Bearer",
      scope: response.scope ?? this.auth?.scope,
      expiresAt,
    };
  }

  private async requestToken(params: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": DEFAULT_USER_AGENT,
      },
      body: params.toString(),
    });

    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || payload.error) {
      throw new Error(payload.error_description ?? payload.error ?? "WuxiaWorld token exchange failed.");
    }

    return payload;
  }

  private async ensureAccessToken(): Promise<string | undefined> {
    if (!this.auth?.accessToken && !this.auth?.refreshToken) {
      return undefined;
    }

    if (!authExpiresSoon(this.auth) && this.auth?.accessToken) {
      return this.auth.accessToken;
    }

    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.auth?.refreshToken) {
      if (this.auth?.accessToken) {
        return this.auth.accessToken;
      }

      throw new Error("No WuxiaWorld access token is available.");
    }

    try {
      const response = await this.requestToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: OIDC_CLIENT_ID,
          refresh_token: this.auth.refreshToken,
        }),
      );

      this.saveTokenResponse(response);
      this.persistSession();
      return this.auth.accessToken;
    } catch (error) {
      this.auth = undefined;
      this.persistSession();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.includes("invalid_grant") ? "The saved WuxiaWorld session expired. Press l to log in again." : message);
    }
  }

  private async requestGrpcChapter(novelSlug: string, chapterSlug: string) {
    const accessToken = await this.ensureAccessToken();
    const headers = new Headers({
      accept: "application/grpc-web+proto",
      "accept-language": "en-US,en;q=0.9",
      "client-version": GRPC_CLIENT_VERSION,
      "content-type": "application/grpc-web+proto",
      "user-agent": DEFAULT_USER_AGENT,
      "x-grpc-web": "1",
      "x-user-agent": "grpc-web-javascript/0.1",
    });

    if (accessToken) {
      headers.set("authorization", `${this.auth?.tokenType ?? "Bearer"} ${accessToken}`);
    }

    const response = await fetch(`${GRPC_ORIGIN}/wuxiaworld.api.v2.Chapters/GetChapter`, {
      method: "POST",
      headers,
      body: Buffer.from(wrapGrpcWebRequest(encodeGetChapterRequest(novelSlug, chapterSlug))),
    });

    if (!response.ok) {
      throw new Error(`WuxiaWorld chapter API returned HTTP ${response.status}.`);
    }

    const payload = parseGrpcWebPayload(new Uint8Array(await response.arrayBuffer()));
    const grpcStatus = payload.trailers.get("grpc-status");
    if (grpcStatus && grpcStatus !== "0") {
      const grpcMessage = payload.trailers.get("grpc-message");

      if (grpcStatus === "16") {
        if (this.auth?.refreshToken || this.auth?.accessToken) {
          this.auth = undefined;
          this.persistSession();
          throw new Error("The saved WuxiaWorld session expired. Press l to log in again.");
        }

        throw new Error(grpcMessage ?? "WuxiaWorld rejected the current chapter session.");
      }

      throw new Error(grpcMessage ? `WuxiaWorld chapter API error: ${grpcMessage}` : `WuxiaWorld chapter API returned grpc-status ${grpcStatus}.`);
    }

    if (!payload.message || payload.message.length === 0) {
      return {
        slug: chapterSlug,
        title: chapterSlug,
        html: "",
        isTeaser: true,
      };
    }

    return decodeGetChapterResponse(payload.message);
  }

  private async searchNovelsPage(
    options: RemoteNovelSearchOptions,
    searchAfterId?: number,
  ): Promise<RemoteNovelSearchPage> {
    const payload = await this.requestGrpcNovelSearch({
      title: options.title?.trim() || undefined,
      status: grpcStatus(options.status ?? "all"),
      sortType: grpcSortType(options.sort),
      sortDirection: grpcSortDirection(options.sort),
      searchAfterId,
      count: 16,
    });

    const items = mapSearchResults(payload);

    return {
      items,
      total: payload.total || items.length,
      nextSearchAfterId: items.at(-1)?.id,
    };
  }

  private async requestGrpcNovelSearch(request: {
    title?: string;
    status: number;
    sortType: number;
    sortDirection: number;
    searchAfterId?: number;
    count: number;
  }) {
    const accessToken = await this.ensureAccessToken().catch(() => undefined);
    const headers = new Headers({
      accept: "application/grpc-web+proto",
      "accept-language": "en-US,en;q=0.9",
      "client-version": GRPC_CLIENT_VERSION,
      "content-type": "application/grpc-web+proto",
      "user-agent": DEFAULT_USER_AGENT,
      "x-grpc-web": "1",
      "x-user-agent": "grpc-web-javascript/0.1",
    });

    if (accessToken) {
      headers.set("authorization", `${this.auth?.tokenType ?? "Bearer"} ${accessToken}`);
    }

    const response = await fetch(`${GRPC_ORIGIN}/wuxiaworld.api.v2.Novels/SearchNovels`, {
      method: "POST",
      headers,
      body: Buffer.from(wrapGrpcWebRequest(encodeSearchNovelsRequest(request))),
    });

    if (!response.ok) {
      throw new Error(`WuxiaWorld novels API returned HTTP ${response.status}.`);
    }

    const payload = parseGrpcWebPayload(new Uint8Array(await response.arrayBuffer()));
    const grpcStatus = payload.trailers.get("grpc-status");
    if (grpcStatus && grpcStatus !== "0") {
      const grpcMessage = payload.trailers.get("grpc-message");

      if (grpcStatus === "16") {
        if (this.auth?.refreshToken || this.auth?.accessToken) {
          this.auth = undefined;
          this.persistSession();
          throw new Error("The saved WuxiaWorld session expired. Press l to log in again.");
        }

        throw new Error(grpcMessage ?? "WuxiaWorld rejected the current catalog session.");
      }

      throw new Error(grpcMessage ? `WuxiaWorld novels API error: ${grpcMessage}` : `WuxiaWorld novels API returned grpc-status ${grpcStatus}.`);
    }

    if (!payload.message) {
      throw new Error("WuxiaWorld novels API returned no catalog data.");
    }

    return decodeSearchNovelsResponse(payload.message);
  }

  private async requestText(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      referer?: string;
      accept?: string;
      stopRedirect?: (nextUrl: URL) => boolean;
    } = {},
  ): Promise<TextResponse> {
    const maxRedirects = 10;
    let currentUrl = new URL(url);
    let method = options.method ?? "GET";
    let body = options.body;
    let referer = options.referer;
    const headers = new Headers(options.headers ?? {});

    headers.set("user-agent", DEFAULT_USER_AGENT);
    headers.set("accept-language", "en-US,en;q=0.9");
    headers.set("accept", options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const requestHeaders = new Headers(headers);
      const cookieHeader = this.jar.getCookieHeader(currentUrl);
      if (cookieHeader) {
        requestHeaders.set("cookie", cookieHeader);
      }

      if (referer) {
        requestHeaders.set("referer", referer);
      }

      const response = await fetch(currentUrl, {
        method,
        headers: requestHeaders,
        body,
        redirect: "manual",
      });

      const cookieChanged = this.jar.storeFromHeaders(response.headers, currentUrl);
      if (cookieChanged) {
        this.persistSession();
      }

      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.has("location") &&
        redirectCount < maxRedirects
      ) {
        const location = response.headers.get("location");
        if (!location) {
          break;
        }

        referer = currentUrl.toString();
        currentUrl = new URL(location, currentUrl);

        if (options.stopRedirect?.(currentUrl)) {
          return {
            text: "",
            url: currentUrl.toString(),
            status: response.status,
            headers: response.headers,
          };
        }

        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
          headers.delete("content-type");
        }

        continue;
      }

      return {
        text: await response.text(),
        url: currentUrl.toString(),
        status: response.status,
        headers: response.headers,
      };
    }

    throw new Error("Too many redirects while talking to WuxiaWorld.");
  }
}
