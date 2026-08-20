# Meta Checker

A tiny zero-dependency tool that inspects the SEO and social-sharing meta tags of any URL. Enter a URL, get a social preview mock, a pass/fail checklist of required tags, and the full raw meta list.

Runs entirely on [Bun](https://bun.sh) with no npm packages — HTML parsing uses Bun's built-in `HTMLRewriter`.

## Quick start

```sh
bun server.ts
```

Then open http://localhost:3000, type a URL, and hit Check.

- Requires Bun 1.x
- Default port is `3000`; override with `PORT=4000 bun server.ts`

## What it checks

The tool flags each of these as present or missing:

| Tag | Used by |
| --- | --- |
| `<title>` | Google/Bing search result snippets |
| `meta description` | Search result snippets |
| `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `og:site_name` | Facebook, WhatsApp, iMessage, Slack, Discord, LinkedIn link previews |
| `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image` | X / Twitter cards (falls back to Open Graph when absent) |
| `canonical` link | Authoritative page URL for search engines |
| Favicon | Browser tabs and bookmarks |
| `charset`, `viewport`, `html lang` | Basic correctness and accessibility |

## How it works

```
browser (index.html)                Bun server (server.ts)
┌────────────────────┐              ┌──────────────────────────────┐
│ SPA, vanilla JS    │   /api/meta  │ fetch target page server-side │
│ preview + checklist│ ───────────► │ HTMLRewriter → JSON           │
│                    │              └──────────────────────────────┘
│ preview <img>      │   /api/image │ fetch og:image, validate      │
│                    │ ───────────► │ content-type, return same-origin
└────────────────────┘              └──────────────────────────────┘
```

- **Server-side fetching** (`/api/meta?url=...`) avoids browser CORS restrictions on the target site.
- **`HTMLRewriter`** streams through the HTML once to collect `<title>`, every `<meta>`, the canonical link, favicon, and `html lang`.
- **Image proxy** (`/api/image?url=...`): the preview image loads through the server instead of cross-origin. This avoids Chrome's OpaqueResponseBlocking (which blocks cross-origin loads whose content-type doesn't match), CORS issues, and hotlink protection. Non-image responses are rejected with `415`.
- **Local dev servers**: typing `localhost:4321` (no protocol) is treated as plain HTTP; an `https://` fetch that fails to connect retries over `http://`.

## API

### `GET /api/meta?url=<url>`

Fetches and parses the page. Returns JSON with `title`, `lang`, `charset`, `canonical`, `favicon`, grouped `og`/`twitter` objects, the raw `metas` list, and a `checklist` of present/missing tags.

Error responses include `status: "error"` with a message, and use `400` (missing param), `415` (non-image, image endpoint), `422` (target is not HTML), or `502` (fetch/parse failure).

### `GET /api/image?url=<url>`

Proxies an image for the preview card. Returns the image with its original content-type and a 1-hour cache header, or `415` if the target isn't an image.

## Files

- `server.ts` — Bun server: static file serving + API endpoints
- `index.html` — self-contained SPA (inline CSS/JS, no build step)
