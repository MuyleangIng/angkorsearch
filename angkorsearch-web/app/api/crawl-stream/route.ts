import { type NextRequest } from 'next/server'

// Internal Docker network URL — server-side only, never exposed to browser
const API = process.env.API_INTERNAL_URL ?? 'http://api:8080'

function encode(data: object) {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return new Response('Missing ?url=', { status: 400 })
  }

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (type: string, msg: string, extra?: object) =>
        ctrl.enqueue(enc.encode(encode({ type, msg, ts: new Date().toISOString(), ...extra })))

      const close = (type: string, msg: string) => {
        ctrl.enqueue(enc.encode(encode({ type, msg, ts: new Date().toISOString(), done: true })))
        ctrl.close()
      }

      send('system', 'AngkorSearch Force Crawler v2.3')
      send('system', '─'.repeat(52))
      send('info',   `Target       : ${url}`)
      send('info',   'Mode         : Direct crawl (bypasses queue — immediate index)')
      send('system', '─'.repeat(52))
      send('info',   'Resolving hostname...')
      send('info',   'Establishing HTTPS connection to target server...')
      send('info',   'Sending GET request with AngkorSearchBot/2.2 user-agent...')
      send('wait',   'Fetching page content — please wait...')

      // ── Direct crawl: POST /admin/crawl-now (blocks until fetch + parse + save) ──
      let crawlData: {
        ok?: boolean
        error?: string
        msg?: string
        title?: string
        desc?: string
        lang?: string
        type?: string
        words?: number
        chars?: number
      }

      try {
        const body = new URLSearchParams({ url })
        const res = await fetch(`${API}/admin/crawl-now`, {
          method:  'POST',
          body:    body.toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal:  AbortSignal.timeout(25000),
          cache:   'no-store',
        })
        crawlData = await res.json()
      } catch (e: unknown) {
        close('error', `Network error: ${e instanceof Error ? e.message : String(e)}`)
        return
      }

      // ── Handle failure ───────────────────────────────────────────────────
      if (!crawlData.ok) {
        send('system', '─'.repeat(52))
        if (crawlData.error === 'fetch_failed') {
          send('error', 'Could not fetch the target URL.')
          send('warn',  crawlData.msg ?? 'The server may be unreachable, returned a non-200 status, or timed out.')
          send('info',  'Tip: Verify the URL is publicly reachable and returns HTML content.')
        } else {
          send('error', crawlData.msg ?? crawlData.error ?? 'Unknown error from crawl API.')
        }
        close('error', 'Crawl failed — see details above.')
        return
      }

      // ── Handle success ───────────────────────────────────────────────────
      send('ok',     'HTTP 200 received — parsing HTML')
      send('ok',     'Title, description, language and text extracted')
      send('ok',     'Saving to PostgreSQL pages table...')
      send('system', '─'.repeat(52))
      send('info',   `Title        : ${crawlData.title || '(no title)'}`)
      send('info',   `Language     : ${crawlData.lang  || 'unknown'}`)
      send('info',   `Content type : ${crawlData.type  || 'web'}`)
      send('info',   `Words indexed: ${crawlData.words?.toLocaleString() ?? '?'}`)
      if (crawlData.desc) {
        const preview = crawlData.desc.slice(0, 160) + (crawlData.desc.length > 160 ? '…' : '')
        send('info',  `Description  : ${preview}`)
      }
      send('system', '─'.repeat(52))
      send('ok',     'Page saved — searchable on AngkorSearch immediately')
      // Also push into background queue at P0 so crawler re-crawls it for links
      try {
        const qBody = new URLSearchParams({ url, type: crawlData.type ?? 'web' })
        await fetch(`${API}/admin/queue`, {
          method:  'POST',
          body:    qBody.toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          cache:   'no-store',
        })
        send('info', 'Also queued for full link-discovery crawl in background')
      } catch { /* non-critical */ }

      close('done', 'Crawl complete — stream closed.')
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
