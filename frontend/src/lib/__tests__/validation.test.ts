import { describe, expect, it } from 'vitest'
import {
  computeSha256Hex,
  normalizeSnippetWhitespace,
  validateImmutableEvidenceUrl,
} from '../validation'

describe('validateImmutableEvidenceUrl', () => {
  const validDanLuu =
    'https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/README.md'
  const validRebuff =
    'https://raw.githubusercontent.com/protectai/rebuff/4d2fe064abf164e7381556d23e48e210080f8afa/python-sdk/tests/test_sdk.py'

  it('accepts raw.githubusercontent.com URL with 40-hex commit SHA', () => {
    const res = validateImmutableEvidenceUrl(validDanLuu)
    expect(res.valid).toBe(true)
    expect(res.host).toBe('raw.githubusercontent.com')
  })

  it('rejects mutable branch or tag URLs on raw.githubusercontent.com', () => {
    const mainUrl =
      'https://raw.githubusercontent.com/danluu/post-mortems/main/README.md'
    const tagUrl =
      'https://raw.githubusercontent.com/danluu/post-mortems/refs/tags/v1.0.0/README.md'
    const shortShaUrl =
      'https://raw.githubusercontent.com/danluu/post-mortems/630562e552/README.md'

    expect(validateImmutableEvidenceUrl(mainUrl).valid).toBe(false)
    expect(validateImmutableEvidenceUrl(tagUrl).valid).toBe(false)
    expect(validateImmutableEvidenceUrl(shortShaUrl).valid).toBe(false)
  })

  it('accepts immutable web.archive.org 14-digit id_ snapshot and rejects non-id_ snapshots', () => {
    const validArchive =
      'https://web.archive.org/web/20240101120000id_/https://example.com/outage.txt'
    const invalidArchive =
      'https://web.archive.org/web/20240101120000/https://example.com/outage.txt'

    expect(validateImmutableEvidenceUrl(validArchive).valid).toBe(true)
    expect(validateImmutableEvidenceUrl(invalidArchive).valid).toBe(false)
  })

  it('accepts immutable en.wikipedia.org action=parse&oldid=<digits> and rejects mutable wiki pages', () => {
    const validWiki =
      'https://en.wikipedia.org/w/api.php?action=parse&oldid=123456789'
    const invalidWiki = 'https://en.wikipedia.org/wiki/Outage'

    expect(validateImmutableEvidenceUrl(validWiki).valid).toBe(true)
    expect(validateImmutableEvidenceUrl(invalidWiki).valid).toBe(false)
  })

  it('enforces allowedPrefix when specified', () => {
    const prefix =
      'https://raw.githubusercontent.com/protectai/rebuff/4d2fe064abf164e7381556d23e48e210080f8afa/'
    expect(validateImmutableEvidenceUrl(validRebuff, prefix).valid).toBe(true)
    expect(validateImmutableEvidenceUrl(validDanLuu, prefix).valid).toBe(false)
  })

  it('rejects non-HTTPS and unapproved hosts', () => {
    expect(
      validateImmutableEvidenceUrl(
        'http://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/README.md'
      ).valid
    ).toBe(false)
    expect(
      validateImmutableEvidenceUrl('https://pastebin.com/raw/abcdef').valid
    ).toBe(false)
  })
})

describe('computeSha256Hex & normalizeSnippetWhitespace', () => {
  it('computes exact WebCrypto SHA-256 hex digest for NIST vector and normalizes CRLF', async () => {
    const digest = await computeSha256Hex('abc')
    expect(digest).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    const lf = await computeSha256Hex('line1\nline2')
    const crlf = await computeSha256Hex('line1\r\nline2')
    expect(crlf).toBe(lf)
  })

  it('collapses multiline whitespace uniformly', () => {
    expect(normalizeSnippetWhitespace('line one\n   line\t\ttwo\n')).toBe(
      'line one line two'
    )
  })
})
