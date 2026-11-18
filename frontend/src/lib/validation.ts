export interface UrlValidationResult {
  valid: boolean
  reason?: string
  host?: string
}

const GITHUB_SHA_PATH_RE = /^\/[^/]+\/[^/]+\/[0-9a-fA-F]{40}\/.+/
const ARCHIVE_ID_PATH_RE = /^\/web\/\d{14}id_\/https?:\/\/.+/

/**
 * Mirrors contracts/cascade.py immutable evidence URL allowlist 1-for-1:
 * - Requires HTTPS URL
 * - Enforces host-specific immutability:
 *   - raw.githubusercontent.com: 40-hex commit SHA path segment
 *   - web.archive.org: /web/<14-digit>id_/http(s)://...
 *   - en.wikipedia.org: /w/api.php?action=parse&oldid=<digits>
 * - Optional allowedPrefix enforcement matching pool's allowed_source_prefix
 */
export function validateImmutableEvidenceUrl(
  rawUrl: string,
  allowedPrefix?: string
): UrlValidationResult {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return { valid: false, reason: 'Evidence URL is required.' }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { valid: false, reason: 'Invalid URL format.' }
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Evidence URL must use HTTPS.' }
  }

  const host = parsed.hostname.toLowerCase()

  if (host === 'raw.githubusercontent.com') {
    if (!GITHUB_SHA_PATH_RE.test(parsed.pathname)) {
      return {
        valid: false,
        reason:
          'raw.githubusercontent.com URLs must pin an immutable 40-hex commit SHA (mutable branches/tags are rejected).',
        host,
      }
    }
  } else if (host === 'web.archive.org') {
    if (!ARCHIVE_ID_PATH_RE.test(parsed.pathname)) {
      return {
        valid: false,
        reason:
          'web.archive.org URLs must use an immutable raw snapshot path (/web/<14-digit>id_/https://...).',
        host,
      }
    }
  } else if (host === 'en.wikipedia.org') {
    const action = parsed.searchParams.get('action')
    const oldid = parsed.searchParams.get('oldid') ?? ''
    if (
      parsed.pathname !== '/w/api.php' ||
      action !== 'parse' ||
      !/^\d+$/.test(oldid)
    ) {
      return {
        valid: false,
        reason:
          'en.wikipedia.org URLs must use /w/api.php?action=parse&oldid=<digits>.',
        host,
      }
    }
  } else {
    return {
      valid: false,
      reason: `Host "${host}" is not in the immutable evidence allowlist (raw.githubusercontent.com, web.archive.org, en.wikipedia.org).`,
      host,
    }
  }

  if (allowedPrefix && allowedPrefix.trim().length > 0) {
    const prefix = allowedPrefix.trim()
    if (!trimmed.startsWith(prefix)) {
      return {
        valid: false,
        reason: `Evidence URL must start with pool's allowed_source_prefix: ${prefix}`,
        host,
      }
    }
  }

  return { valid: true, host }
}

/**
 * Computes lowercase hex SHA-256 using WebCrypto subtle.digest (normalizing CRLF to LF).
 */
export async function computeSha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto subtle.digest is unavailable in this environment.')
  }
  const normalized = input.replace(/\r\n/g, '\n')
  const bytes = new TextEncoder().encode(normalized)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Mirrors contract whitespace normalization for snippet slicing before SHA-256.
 */
export function normalizeSnippetWhitespace(snippet: string): string {
  return snippet.split(/\s+/).filter(Boolean).join(' ')
}
