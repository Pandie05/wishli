// deno edge function -- fetches a product page server-side and pulls out
// title/image/price so the browser doesn't have to (and can't, cors blocks
// that from most sites). best-effort: not every site yields a price.
//
// Amazon is a special case, but not the hopeless one it was once written up
// as. The page does come back -- Deno's fetch is served the real product HTML,
// not the CAPTCHA -- it simply carries none of the metadata the generic
// readers above look for. There is no og:image and no JSON-LD offer, so the
// generic path finds a title and nothing else, which is exactly the "name but
// no picture and no price" everyone was seeing.
//
// Everything wanted is in the markup under other names, so `amazonFromHtml`
// goes and gets it: #productTitle (far cleaner than the "Amazon.com: ..."
// <title>), the buybox price blob, and #landingImage. Verified against real
// pages spanning first-party, third-party and multi-variant listings.
//
// The URL-derived fallbacks below still matter, because the CAPTCHA does turn
// up sometimes -- it is fingerprinting the client, and Node's fetch gets
// walled where Deno's and curl's do not, so treat any rewrite here as able to
// lose the page entirely. When that happens a name still comes from the URL
// slug and a picture may still come from the ASIN endpoint.
//
// Whatever is still blank after all that is the owner's to fill in, and
// `priceUnavailable` / `imageUnavailable` tell the caller to ask rather than
// leave a blank field that reads as a half-finished load.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// a plausible browser. the old 'wishli-link-preview' string was rejected out of
// hand by plenty of ordinary retail sites, not only Amazon.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

type Preview = { title: string | null; image: string | null; price: number | null }
/** What the caller gets: a preview, plus what it should go on to ask for. */
type PreviewResponse = Preview & { priceUnavailable: boolean; imageUnavailable: boolean }

function metaContent(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const match = html.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
    )
    if (match) return match[1]
  }
  return null
}

function jsonLdPrice(html: string): number | null {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const script of scripts) {
    try {
      const data = JSON.parse(script[1])
      const nodes = Array.isArray(data) ? data : [data]
      for (const node of nodes) {
        const offers =
          node.offers ?? node['@graph']?.find((n: { offers?: unknown }) => n.offers)?.offers
        const price = Array.isArray(offers) ? offers[0]?.price : offers?.price
        if (price != null) {
          const parsed = Number(price)
          if (!Number.isNaN(parsed)) return parsed
        }
      }
    } catch {
      // not valid json-ld, skip it
    }
  }
  return null
}

/** amazon.com, amazon.co.uk, www.amazon.de, smile.amazon.com ... */
export function isAmazon(url: URL): boolean {
  return /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(url.hostname)
}

/**
 * The ASIN out of any of the shapes Amazon uses:
 *   /dp/B09XS7JWHH            /Sony-Headphones/dp/B09XS7JWHH
 *   /gp/product/B09XS7JWHH    /gp/aw/d/B09XS7JWHH
 *   /product/B09XS7JWHH       ?asin=B09XS7JWHH
 */
export function amazonAsin(url: URL): string | null {
  const path = url.pathname.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|gp\/offer-listing|product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
  )
  if (path) return path[1].toUpperCase()

  const query = url.searchParams.get('asin')
  return query && /^[A-Z0-9]{10}$/i.test(query) ? query.toUpperCase() : null
}

/**
 * Amazon puts a human-readable slug in front of /dp/, so a usable name can be
 * had without fetching anything:
 *   /Sony-WH-1000XM5-Wireless-Headphones/dp/B09XS7JWHH
 *   -> "Sony WH 1000XM5 Wireless Headphones"
 */
export function amazonSlugTitle(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean)
  const marker = segments.findIndex((s) => /^(dp|gp|product)$/i.test(s))
  if (marker < 1) return null

  const slug = decodeURIComponent(segments[marker - 1])
  // a bare /dp/ASIN url has no slug, and the segment before it is the locale
  // or nothing useful
  if (/^[A-Z0-9]{10}$/i.test(slug) || slug.length < 4 || !slug.includes('-')) return null

  const words = slug.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words.length >= 3 ? words : null
}

/** The rendered price, e.g. <span class="a-offscreen">$248.00</span>. The
 *  leading run covers the currency symbol, which varies by marketplace. */
const OFFSCREEN_MONEY = /<span class="a-offscreen">\s*[^\d<]{0,3}([\d,]+\.?\d*)\s*<\/span>/

function firstMoney(chunk: string | undefined): number | null {
  const match = chunk?.match(OFFSCREEN_MONEY)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

/**
 * Amazon's price, in descending order of how much it can be trusted. A page
 * legitimately has none -- "Currently unavailable" listings show no figure at
 * all -- so null here is an answer, not a failure.
 */
function amazonPrice(html: string): number | null {
  // the buybox blob is an exact current price and names the offer it belongs
  // to, so a used or refurbished offer cannot be mistaken for the new one
  const blob = html.match(/"desktop_buybox_group_1":\s*\[([\s\S]{0,6000}?)\}\s*\]/)
  if (blob) {
    const offers = [
      ...blob[1].matchAll(/"priceAmount":\s*([\d.]+)[\s\S]{0,800}?"buyingOptionType":"([A-Z]+)"/g),
    ]
    const chosen = offers.find((o) => o[2] === 'NEW') ?? offers[0]
    if (chosen) {
      const value = Number(chosen[1])
      if (!Number.isNaN(value)) return value
    }
  }

  // otherwise the block the page actually renders at the top of the buy area
  const core = firstMoney(html.match(/id="corePrice(?:_desktop|_feature_div)"[\s\S]{0,3000}/)?.[0])
  if (core != null) return core

  // a listing with variants has no single price until a size or colour is
  // picked -- Amazon shows "from $x" there, and so, then, do we
  return firstMoney(html.match(/<span class="a-price-range">[\s\S]{0,600}/)?.[0])
}

/** The main product shot, off the gallery's landing image. */
function amazonImage(html: string): string | null {
  const landing = html.match(/<img[^>]*id="landingImage"[^>]*>/)?.[0]
  if (landing) {
    const hires = landing.match(/data-old-hires="(https:[^"]+)"/)
    if (hires) return hires[1]

    // no full-size version, so take the largest of the responsive set
    const dynamic = landing.match(/data-a-dynamic-image="([^"]+)"/)
    if (dynamic) {
      try {
        const sizes: Record<string, number[]> = JSON.parse(
          dynamic[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
        )
        const widest = Object.entries(sizes).sort((a, b) => (b[1][0] ?? 0) - (a[1][0] ?? 0))[0]
        if (widest) return widest[0]
      } catch {
        // not the json we expected, fall through to the gallery blob
      }
    }
  }

  // the gallery's own data, for the layouts that have no landing image
  return html.match(/"hiRes":"(https:[^"]+)"/)?.[1] ?? html.match(/"large":"(https:[^"]+)"/)?.[1] ?? null
}

/**
 * What the generic OpenGraph/JSON-LD readers cannot see on an Amazon page.
 * Only fields it is actually confident about come back set, so the caller can
 * layer this over the generic result without blanking anything.
 */
function amazonFromHtml(html: string): Preview {
  const title = html
    .match(/<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim()

  return {
    title: title || null,
    image: amazonImage(html),
    price: amazonPrice(html),
  }
}

/**
 * Amazon serves product art keyed by ASIN here, no page fetch needed. It is
 * the only such endpoint left: the associate ad widget that used to resolve
 * any ASIN (ws-na.amazon-adsystem.com/widgets/q?...ID=AsinImage) has been
 * retired -- the whole ws-*.amazon-adsystem.com family no longer has DNS
 * records -- so there is nothing to fall back to when this misses. Please do
 * not re-add it; it is not down, it is gone.
 *
 * Coverage is real but partial. Major brands and anything Amazon sells itself
 * resolve; a good share of third-party listings answer with the placeholder
 * below instead, and no marketplace digit (.01/.02/...) or size suffix
 * changes that. It only has to carry the walled case, though -- when the page
 * arrives, `amazonImage` reads the real gallery shot and this is never asked.
 */
function amazonImageUrl(asin: string): string {
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`
}

// a miss is answered with a 43-byte placeholder gif rather than a 404; real
// art runs to several kilobytes
const MIN_IMAGE_BYTES = 1500

/** Confirms the CDN actually has art rather than that placeholder. */
async function imageExists(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  try {
    // a GET rather than a HEAD, so a placeholder served without a declared
    // length can still be caught by weighing it; the body is dropped unread
    // whenever the header alone settles it
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok || !/^image\//i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel()
      return false
    }

    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > 0) {
      await res.body?.cancel()
      return declared > MIN_IMAGE_BYTES
    }

    // no declared length, so there is nothing for it but to read and count
    return (await res.arrayBuffer()).byteLength > MIN_IMAGE_BYTES
  } catch {
    clearTimeout(timeout)
    return false
  }
}

/** Amazon's bot wall, so we do not mistake the CAPTCHA page for a product. */
function isBotWall(html: string): boolean {
  return (
    /Enter the characters you see below/i.test(html) ||
    /errors\/validateCaptcha/i.test(html) ||
    /To discuss automated access to Amazon data/i.test(html)
  )
}

const BLANK: Preview = { title: null, image: null, price: null }

/** The page's own markup comes back alongside the preview, since a site with
 *  its own reader (Amazon) needs a second look at it. `html` is null when
 *  there was nothing usable to read -- a bad status, or the bot wall. */
async function fetchPage(url: string): Promise<{ preview: Preview; html: string | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS })
    clearTimeout(timeout)

    const html = await res.text()
    if (!res.ok || isBotWall(html)) return { preview: BLANK, html: null }

    const priceMeta = metaContent(html, 'product:price:amount', 'og:price:amount')
    const price = priceMeta ? Number(priceMeta) : jsonLdPrice(html)

    return {
      preview: {
        title:
          metaContent(html, 'og:title')?.trim() ??
          html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ??
          null,
        image: metaContent(html, 'og:image'),
        price: price != null && !Number.isNaN(price) ? price : null,
      },
      html,
    }
  } catch {
    clearTimeout(timeout)
    return { preview: BLANK, html: null }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const parsed = new URL(url)
    const { preview: fetched, html } = await fetchPage(url)
    const preview: PreviewResponse = {
      ...fetched,
      priceUnavailable: false,
      imageUnavailable: false,
    }

    if (isAmazon(parsed)) {
      // the site-specific reader wins outright where it finds something: the
      // generic pass can only ever have come up with the "Amazon.com: ..."
      // <title>, and nothing at all for the picture or the price
      if (html) {
        const amazon = amazonFromHtml(html)
        preview.title = amazon.title ?? preview.title
        preview.image = amazon.image ?? preview.image
        preview.price = amazon.price ?? preview.price
      }

      // and if the page never arrived, the url alone still carries a name, and
      // the ASIN a chance of a picture
      if (!preview.title) preview.title = amazonSlugTitle(parsed)

      if (!preview.image) {
        const asin = amazonAsin(parsed)
        if (asin) {
          const candidate = amazonImageUrl(asin)
          if (await imageExists(candidate)) preview.image = candidate
        }
      }

      // whatever is still blank is not coming -- either the page had none to
      // give (an unavailable listing shows no price at all) or we never got
      // the page. say so, rather than leave the caller staring at an empty
      // field wondering if we had simply not finished loading.
      preview.priceUnavailable = preview.price == null
      preview.imageUnavailable = preview.image == null
    }

    // only a total blank is worth reporting as a failure -- a partial fill is
    // still better than making someone type everything
    if (!preview.title && !preview.image && preview.price == null) {
      return new Response(JSON.stringify({ error: 'could not read that link' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(preview), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'could not fetch that link' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
