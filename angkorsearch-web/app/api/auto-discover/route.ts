import { type NextRequest } from 'next/server'

const API         = process.env.API_INTERNAL_URL ?? 'http://api:8080'
const CONCURRENCY = 8    // parallel crawls at once
const TIMEOUT_MS  = 8000 // 8s per URL (fast fail)

// ── All TLDs to probe ──────────────────────────────────────────────────────────
const TLDS = [
  '.com', '.me',   '.io',   '.dev',  '.net',  '.org',  '.app',
  '.co',  '.site', '.tech', '.xyz',  '.online','.info', '.cc',
  '.to',  '.sh',   '.gg',   '.page', '.link',  '.live',
]

// ── Generate every plausible URL for a query ──────────────────────────────────
function guessUrls(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (q.length > 60) return []

  const words = q
    .split(/\s+/)
    .filter(w => /^[a-z0-9-]+$/.test(w) && w.length >= 2)
  if (words.length === 0 || words.length > 4) return []

  // Only skip pure grammar/filler words — never skip topic words like 'khmer', 'cambodia'
  const grammarOnly = ['what','how','why','when','where','the','and','for','is','are','was','a','an']
  if (words.every(w => grammarOnly.includes(w))) return []

  // ── Name variants ────────────────────────────────────────────────────────────
  const rev     = [...words].reverse()
  const slug    = words.join('')            // mengseuthoeng
  const dash    = words.join('-')           // mengseu-thoeng
  const revSlug = rev.join('')              // thoengmengseu
  const revDash = rev.join('-')             // thoeng-mengseu
  const initials = words.map(w => w[0]).join('') // mt
  const first   = words[0]                  // mengseu
  const last    = words[words.length - 1]   // thoeng

  // Ordered by likelihood — checked first in parallel
  const handles: string[] = []
  const addH = (h: string) => { if (h && !handles.includes(h)) handles.push(h) }
  addH(dash)       // mengseu-thoeng  ← most common for personal sites
  addH(slug)       // mengseuthoeng
  addH(revDash)    // thoeng-mengseu
  addH(revSlug)    // thoengmengseu
  addH(first)      // mengseu
  addH(last)       // thoeng
  if (initials.length >= 2) addH(initials) // mt

  const urls: string[] = []
  const seen = new Set<string>()
  const add  = (u: string) => { if (!seen.has(u)) { seen.add(u); urls.push(u) } }

  // ── 1. GitHub (highest signal for developers) ─────────────────────────────
  for (const h of handles) {
    add(`https://github.com/${h}`)
    add(`https://${h}.github.io`)
  }

  // ── 2. GitLab ─────────────────────────────────────────────────────────────
  for (const h of handles) {
    add(`https://gitlab.com/${h}`)
  }

  // ── 3. Personal / project websites — every handle × every TLD ────────────
  for (const h of handles) {
    for (const tld of TLDS) {
      add(`https://${h}${tld}`)
    }
  }

  // ── 4. Subdomain patterns ─────────────────────────────────────────────────
  if (words.length === 2) {
    add(`https://${words[0]}.${words[1]}.com`)
    add(`https://${words[1]}.${words[0]}.com`)
    add(`https://${words[0]}.${words[1]}.io`)
    add(`https://${words[0]}.${words[1]}.me`)
  }

  // ── 5. Developer platforms ────────────────────────────────────────────────
  for (const h of [dash, slug, revDash, revSlug]) {
    if (!h) continue
    add(`https://dev.to/${h}`)
    add(`https://medium.com/@${h}`)
    add(`https://${h}.hashnode.dev`)
    add(`https://www.npmjs.com/package/${h}`)
    add(`https://pypi.org/user/${h}`)
    add(`https://codepen.io/${h}`)
    add(`https://huggingface.co/${h}`)
  }

  // ── 6. LinkedIn (public profiles — limited but sometimes works) ───────────
  for (const h of [dash, slug]) {
    add(`https://linkedin.com/in/${h}`)
  }

  // ── 7. Vercel / Netlify / Cloudflare Pages deployments ───────────────────
  add(`https://${slug}.vercel.app`)
  add(`https://${dash}.vercel.app`)
  add(`https://${slug}.netlify.app`)
  add(`https://${dash}.netlify.app`)
  add(`https://${slug}.pages.dev`)
  add(`https://${dash}.pages.dev`)

  // ── 8. YouTube channel handle ─────────────────────────────────────────────
  add(`https://www.youtube.com/@${slug}`)
  add(`https://www.youtube.com/@${dash}`)

  // ── 9. Twitter / X public profiles ───────────────────────────────────────
  for (const h of [slug, dash, first]) {
    add(`https://twitter.com/${h}`)
    add(`https://x.com/${h}`)
  }

  // ── 10. Dev.to / Hashnode / Substack ─────────────────────────────────────
  for (const h of [slug, dash]) {
    add(`https://dev.to/${h}`)
    add(`https://${h}.substack.com`)
  }

  return urls
}

// ── Crawl one URL, return ok/title or null ─────────────────────────────────────
async function crawlUrl(url: string): Promise<{ ok: true; title: string } | { ok: false }> {
  try {
    const body = new URLSearchParams({ url })
    const res  = await fetch(`${API}/admin/crawl-now`, {
      method:  'POST',
      body:    body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
      cache:   'no-store',
    })
    const data = await res.json()
    return data.ok && data.title ? { ok: true, title: data.title as string } : { ok: false }
  } catch {
    return { ok: false }
  }
}

// ── SSE route ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') ?? ''
  if (!query.trim()) return new Response('Missing ?q=', { status: 400 })

  const candidates = guessUrls(query)
  const enc        = new TextEncoder()
  const encode     = (data: object) => `data: ${JSON.stringify(data)}\n\n`

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (type: string, msg: string, extra?: object) =>
        ctrl.enqueue(enc.encode(encode({ type, msg, ts: new Date().toISOString(), ...extra })))
      const close = (type: string, msg: string, extra?: object) => {
        ctrl.enqueue(enc.encode(encode({ type, msg, ts: new Date().toISOString(), done: true, ...extra })))
        ctrl.close()
      }

      if (candidates.length === 0) {
        close('info', 'Query is too broad or generic for auto-discovery.', { found: 0 })
        return
      }

      send('system', `Web Discovery for "${query}"`)
      send('info',   `Scanning ${candidates.length} URLs in parallel (${CONCURRENCY} at once)...`)

      const found: Array<{ url: string; title: string }> = []

      // ── Parallel pool — CONCURRENCY workers, results stream as they arrive ──
      let nextIdx  = 0
      let active   = 0
      let finished = 0
      const total  = candidates.length

      await new Promise<void>(resolveAll => {
        function spawnNext() {
          while (active < CONCURRENCY && nextIdx < total) {
            const url = candidates[nextIdx++]
            active++
            send('wait', `Checking`, { url })

            crawlUrl(url).then(result => {
              active--
              finished++

              if (result.ok) {
                send('ok', result.title, { url, title: result.title })
                found.push({ url, title: result.title })
              } else {
                send('skip', 'Not reachable', { url })
              }

              if (finished === total) {
                resolveAll()
              } else {
                spawnNext()
              }
            })
          }
        }
        spawnNext()
      })

      if (found.length > 0) {
        close('done',
          `Found ${found.length} page${found.length > 1 ? 's' : ''} — added to index`,
          { found: found.length, pages: found })
      } else {
        close('none', 'No public pages found for this query.', { found: 0 })
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
