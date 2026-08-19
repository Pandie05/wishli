// deno edge function -- fetches a product page server-side and pulls out
// title/image/price so the browser doesn't have to (and can't, cors blocks
// that from most sites). best-effort: not every site yields a price.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
        const offers = node.offers ?? node['@graph']?.find((n: { offers?: unknown }) => n.offers)?.offers
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

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wishli-link-preview)' },
    })
    clearTimeout(timeout)

    const html = await res.text()

    const title = metaContent(html, 'og:title') ?? html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? null
    const image = metaContent(html, 'og:image')
    const priceMeta = metaContent(html, 'product:price:amount', 'og:price:amount')
    const price = priceMeta ? Number(priceMeta) : jsonLdPrice(html)

    return new Response(
      JSON.stringify({
        title: title?.trim() ?? null,
        image,
        price: price != null && !Number.isNaN(price) ? price : null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'could not fetch that link' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
