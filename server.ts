// meta-checker — zero-dependency Bun server
// Serves index.html and exposes GET /api/meta?url=<url> which fetches the
// target page server-side (avoids CORS) and parses its meta tags using
// Bun's built-in HTMLRewriter (no npm packages needed).

const PORT = Number(process.env.PORT) || 3000;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("index.html"), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/meta") {
      const target = url.searchParams.get("url");
      if (!target) return json({ status: "error", error: "Missing ?url= parameter" }, 400);
      return await checkMeta(target);
    }

    if (url.pathname === "/api/image") {
      const target = url.searchParams.get("url");
      if (!target) return json({ status: "error", error: "Missing ?url= parameter" }, 400);
      return await proxyImage(target);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`meta-checker running at http://localhost:${server.port}`);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Collects everything we care about while streaming through the HTML once.
class MetaCollector {
  title = "";
  metas: { key: string; value: string }[] = [];
  canonical = "";
  favicon = "";
  lang = "";

  constructor(private base: string) {}

  meta(el: Element) {
    const key = (
      el.getAttribute("name") ||
      el.getAttribute("property") ||
      el.getAttribute("http-equiv") ||
      ""
    ).toLowerCase();
    const value = el.getAttribute("content") || el.getAttribute("charset") || "";
    if (key) this.metas.push({ key, value });
  }

  link(el: Element) {
    const rel = (el.getAttribute("rel") || "").toLowerCase();
    const href = el.getAttribute("href");
    if (!href) return;
    if (rel === "canonical") this.canonical = new URL(href, this.base).href;
    if (rel.includes("icon")) this.favicon = new URL(href, this.base).href;
  }
}

function resolve(href: string, base: string) {
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

// Proxies the og:image / twitter:image so the browser only ever makes
// same-origin requests. This avoids Chrome's OpaqueResponseBlocking (which
// blocks cross-origin loads whose content-type doesn't match the request)
// and hotlink/CORS issues. Non-image responses are rejected server-side.
async function proxyImage(target: string) {
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "meta-checker/1.0" },
    });
  } catch (err) {
    return json(
      { status: "error", error: `Could not fetch image: ${(err as Error).message}` },
      502,
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return json(
      { status: "error", error: `Not an image (content-type: ${contentType})` },
      415,
    );
  }

  return new Response(await res.arrayBuffer(), {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600",
    },
  });
}

async function checkMeta(target: string) {
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "user-agent": "meta-checker/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    return json(
      { status: "error", url: target, error: `Could not fetch URL: ${(err as Error).message}` },
      502,
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return json(
      {
        status: "error",
        url: target,
        finalUrl: res.url,
        error: `Not HTML (content-type: ${contentType})`,
      },
      422,
    );
  }

  const base = res.url || target;
  const collector = new MetaCollector(base);
  const rewriter = new HTMLRewriter()
    .on("title", { text(t) { collector.title += t.text; } })
    .on("meta", { element(el) { collector.meta(el); } })
    .on("link", { element(el) { collector.link(el); } })
    .on("html", { element(el) { collector.lang = el.getAttribute("lang") || ""; } });

  try {
    await rewriter.transform(res).text();
  } catch (err) {
    return json(
      { status: "error", url: target, error: `Failed to parse HTML: ${(err as Error).message}` },
      502,
    );
  }

  const get = (key: string) => collector.metas.find((m) => m.key === key)?.value || "";

  const og = {
    title: get("og:title"),
    description: get("og:description"),
    image: resolve(get("og:image"), base),
    url: get("og:url"),
    type: get("og:type"),
    site_name: get("og:site_name"),
  };
  const twitter = {
    card: get("twitter:card"),
    title: get("twitter:title"),
    description: get("twitter:description"),
    image: resolve(get("twitter:image"), base),
  };

  const checklist = [
    { key: "title", label: "Title", present: !!collector.title.trim(), value: collector.title.trim() },
    { key: "description", label: "Meta description", present: !!get("description"), value: get("description") },
    { key: "og:title", label: "og:title", present: !!og.title, value: og.title },
    { key: "og:description", label: "og:description", present: !!og.description, value: og.description },
    { key: "og:image", label: "og:image", present: !!og.image, value: og.image },
    { key: "og:url", label: "og:url", present: !!og.url, value: og.url },
    { key: "og:type", label: "og:type", present: !!og.type, value: og.type },
    { key: "twitter:card", label: "twitter:card", present: !!twitter.card, value: twitter.card },
    { key: "twitter:title", label: "twitter:title", present: !!twitter.title, value: twitter.title },
    { key: "twitter:description", label: "twitter:description", present: !!twitter.description, value: twitter.description },
    { key: "twitter:image", label: "twitter:image", present: !!twitter.image, value: twitter.image },
    { key: "canonical", label: "Canonical URL", present: !!collector.canonical, value: collector.canonical },
    { key: "favicon", label: "Favicon", present: !!collector.favicon, value: collector.favicon },
    { key: "charset", label: "Charset", present: !!get("charset"), value: get("charset") },
    { key: "viewport", label: "Viewport", present: !!get("viewport"), value: get("viewport") },
    { key: "lang", label: "html lang", present: !!collector.lang, value: collector.lang },
  ];

  return json({
    status: "ok",
    url: target,
    finalUrl: res.url,
    contentType,
    title: collector.title.trim(),
    lang: collector.lang,
    charset: get("charset"),
    canonical: collector.canonical,
    favicon: collector.favicon,
    og,
    twitter,
    metas: collector.metas,
    checklist,
  });
}