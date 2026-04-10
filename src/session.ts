import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { resolveAppHome } from "./paths";
import { ensurePrivateDirectory, writePrivateTextFile } from "./storage";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  hostOnly: boolean;
  expiresAt?: string;
}

export interface StoredAuthSession {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt?: string;
}

export interface SessionDocument {
  cookies: StoredCookie[];
  auth?: StoredAuthSession;
  savedAt: string;
}

export class SessionStore {
  readonly homeDir: string;
  readonly sessionFilePath: string;

  constructor(homeDir = resolveAppHome()) {
    this.homeDir = homeDir;
    this.sessionFilePath = path.join(this.homeDir, "session.json");
  }

  read(): SessionDocument {
    if (!existsSync(this.sessionFilePath)) {
      return {
        cookies: [],
        savedAt: new Date(0).toISOString(),
      };
    }

    try {
      const raw = readFileSync(this.sessionFilePath, "utf8");
      const parsed = JSON.parse(raw) as SessionDocument;
      return {
        cookies: parsed.cookies ?? [],
        auth: parsed.auth,
        savedAt: parsed.savedAt ?? new Date(0).toISOString(),
      };
    } catch {
      return {
        cookies: [],
        savedAt: new Date(0).toISOString(),
      };
    }
  }

  load(): StoredCookie[] {
    return this.read().cookies;
  }

  loadAuth(): StoredAuthSession | undefined {
    return this.read().auth;
  }

  save(cookies: StoredCookie[], auth?: StoredAuthSession): void {
    ensurePrivateDirectory(this.homeDir);
    writePrivateTextFile(
      this.sessionFilePath,
      JSON.stringify(
        {
          cookies,
          auth,
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  clear(): void {
    rmSync(this.sessionFilePath, { force: true });
  }
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

function parseCookieDate(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function domainMatches(cookie: StoredCookie, host: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedDomain = normalizeDomain(cookie.domain);

  if (cookie.hostOnly) {
    return normalizedHost === normalizedDomain;
  }

  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) {
    return true;
  }

  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }

  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

function isExpired(cookie: StoredCookie): boolean {
  if (!cookie.expiresAt) {
    return false;
  }

  const timestamp = Date.parse(cookie.expiresAt);
  return !Number.isNaN(timestamp) && timestamp <= Date.now();
}

function parseSetCookie(headerValue: string, requestUrl: URL): StoredCookie | undefined {
  const parts = headerValue.split(";").map((part) => part.trim()).filter(Boolean);
  const firstPart = parts.shift();
  if (!firstPart) {
    return undefined;
  }

  const separatorIndex = firstPart.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const name = firstPart.slice(0, separatorIndex).trim();
  const value = firstPart.slice(separatorIndex + 1);
  let domain = requestUrl.hostname;
  let pathName = "/";
  let secure = requestUrl.protocol === "https:";
  let hostOnly = true;
  let expiresAt: string | undefined;

  for (const attribute of parts) {
    const [attributeName, ...rest] = attribute.split("=");
    const normalizedName = attributeName.toLowerCase();
    const attributeValue = rest.join("=");

    if (normalizedName === "domain" && attributeValue) {
      domain = normalizeDomain(attributeValue);
      hostOnly = false;
      continue;
    }

    if (normalizedName === "path" && attributeValue) {
      pathName = attributeValue;
      continue;
    }

    if (normalizedName === "secure") {
      secure = true;
      continue;
    }

    if (normalizedName === "expires" && attributeValue) {
      const expiresTimestamp = parseCookieDate(attributeValue);
      if (expiresTimestamp) {
        expiresAt = new Date(expiresTimestamp).toISOString();
      }
      continue;
    }

    if (normalizedName === "max-age" && attributeValue) {
      const seconds = Number(attributeValue);
      if (!Number.isNaN(seconds)) {
        expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
      }
    }
  }

  return {
    name,
    value,
    domain,
    path: pathName || "/",
    secure,
    hostOnly,
    expiresAt,
  };
}

export class CookieJar {
  private cookies: StoredCookie[];

  constructor(initialCookies: StoredCookie[] = []) {
    this.cookies = initialCookies.filter((cookie) => !isExpired(cookie));
  }

  serialize(): StoredCookie[] {
    this.removeExpired();
    return structuredClone(this.cookies);
  }

  hasCookies(): boolean {
    this.removeExpired();
    return this.cookies.length > 0;
  }

  clear(): void {
    this.cookies = [];
  }

  storeFromHeaders(headers: Headers, requestUrl: URL): boolean {
    const setCookieValues =
      typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : [];

    let changed = false;

    for (const headerValue of setCookieValues) {
      const parsedCookie = parseSetCookie(headerValue, requestUrl);
      if (!parsedCookie) {
        continue;
      }

      this.cookies = this.cookies.filter(
        (cookie) =>
          !(
            cookie.name === parsedCookie.name &&
            normalizeDomain(cookie.domain) === normalizeDomain(parsedCookie.domain) &&
            cookie.path === parsedCookie.path
          ),
      );

      if (parsedCookie.expiresAt && Date.parse(parsedCookie.expiresAt) <= Date.now()) {
        changed = true;
        continue;
      }

      this.cookies.push(parsedCookie);
      changed = true;
    }

    if (changed) {
      this.removeExpired();
    }

    return changed;
  }

  getCookieHeader(requestUrl: URL): string | undefined {
    this.removeExpired();

    const cookies = this.cookies
      .filter((cookie) => (cookie.secure ? requestUrl.protocol === "https:" : true))
      .filter((cookie) => domainMatches(cookie, requestUrl.hostname))
      .filter((cookie) => pathMatches(cookie.path, requestUrl.pathname || "/"))
      .sort((left, right) => right.path.length - left.path.length);

    if (cookies.length === 0) {
      return undefined;
    }

    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  private removeExpired(): void {
    this.cookies = this.cookies.filter((cookie) => !isExpired(cookie));
  }
}
