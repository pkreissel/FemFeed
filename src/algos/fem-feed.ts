import fs from 'fs'
import path from 'path'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import express from 'express'
import { Agent } from '@atproto/api'
import { oauthClient } from '../auth/oauth'
import { validateAuth } from '../auth'
import { firstName } from '../name'

export const shortname = 'fem-feed'

// Posts with a classifier score above this are kept as female-authored. Kept at
// the raw logistic-regression boundary (0) for precision: on real display names,
// lowering it readmits borderline male handles/spellings (e.g. "Kålle", handle
// "LightMikey") that score just below 0 — exactly the men-in-the-feed problem.
// Raise toward +1 for even stricter precision, lower for more recall.
const SCORE_THRESHOLD = 0

// Cache normalized-name -> classifier score across pages and requests. Authors
// repeat heavily on Discover (news orgs, popular accounts), so this avoids
// re-embedding known names — cutting Jina calls, latency and cost, which is what
// makes fetching more pages affordable. Bounded to cap memory.
const NAME_CACHE_CAP = 50000
const nameScoreCache = new Map<string, number>()
function cacheScore(name: string, score: number) {
  if (nameScoreCache.size >= NAME_CACHE_CAP) {
    const oldest = nameScoreCache.keys().next().value
    if (oldest !== undefined) nameScoreCache.delete(oldest)
  }
  nameScoreCache.set(name, score)
}

// Read trained logistic regression weights and bias
let classifier: { w: number[], b: number } | null = null
try {
  const dirPath = path.join(process.cwd(), 'src/classifier.json')
  if (fs.existsSync(dirPath)) {
    classifier = JSON.parse(fs.readFileSync(dirPath, 'utf8'))
  } else {
    console.warn(`classifier.json not found at ${dirPath}. Please run npm run train-classifier first.`)
  }
} catch (e) {
  console.error('Failed to load classifier:', e)
}

function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map((val) => val / magnitude)
}

function dotProduct(vecA: number[], vecB: number[]): number {
  return vecA.reduce((sum, val, idx) => sum + val * vecB[idx], 0)
}

function getUsernameToEmbed(author: { handle: string; displayName?: string }): string {
  if (author.displayName && author.displayName.trim().length > 0) {
    return author.displayName.trim()
  }
  const parts = author.handle.split('.')
  return parts[0] || author.handle
}

export const handler = async (ctx: AppContext, params: QueryParams, req?: express.Request) => {
  const apiKey = process.env.JINA_API_KEY
  if (!apiKey) {
    console.error('JINA_API_KEY is not configured in .env')
    return { feed: [] }
  }

  if (!classifier) {
    console.error('classifier.json is not loaded or missing. Run npm run train-classifier first.')
    return { feed: [] }
  }

  let requesterDid: string | undefined = undefined
  if (req && req.headers.authorization) {
    try {
      requesterDid = await validateAuth(
        req,
        ctx.cfg.serviceDid,
        ctx.didResolver,
      )
      console.log(`[fem-feed] Request authenticated for DID: ${requesterDid}`)
    } catch (e) {
      console.warn('Failed to validate auth:', e)
    }
  }

  let agent: Agent | undefined = undefined
  if (requesterDid) {
    try {
      const session = await oauthClient.restore(requesterDid)
      if (session) {
        agent = new Agent(session)
        console.log(`[fem-feed] Successfully restored OAuth session for ${requesterDid}`)
      } else {
        console.log(`[fem-feed] No active OAuth session found for ${requesterDid} in database`)
      }
    } catch (e) {
      console.error(`[fem-feed] Failed to restore OAuth session for requester ${requesterDid}:`, e)
    }
  }

  // Only ever serve the personalized, authenticated Discover feed. If we couldn't
  // establish an OAuth agent (no auth header, no stored session, or a failed
  // restore), return nothing rather than silently falling back to the global
  // unauthenticated feed — that fallback served logged-in users an unpersonalized,
  // unfiltered feed, which is exactly what we want to avoid.
  if (!agent) {
    console.log('[fem-feed] No authenticated OAuth agent available; returning empty feed instead of the unauthenticated fallback.')
    return { feed: [] }
  }
  const authedAgent = agent

  console.log(`[fem-feed] Starting feed generation. Target limit: ${params.limit}, Cursor: ${params.cursor || 'none'}`)

  // 1. Fetch the discover (whats-hot) feed from AppView
  const feedUri = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'
  
  const targetLimit = params.limit ?? 50
  let currentCursor = params.cursor
  let finalFeed: { post: string }[] = []
  
  const PAGE_SIZE = 100 // AppView hard-caps app.bsky.feed.getFeed at 100 per call
  // ~23% of Discover posts survive the female-author filter, so filling a full
  // 100-post request needs ~5 pages; 8 gives headroom for low-pass stretches.
  // The loop early-exits once targetLimit is reached, so typical requests
  // (limit ~50) still finish in ~3 pages — extra pages only cost latency when
  // the feed is genuinely sparse.
  const MAX_LOOPS = 8

  const clf = classifier // captured non-null (guarded above) for the closures below

  type Page = { feed: any[]; cursor?: string }

  // A transient 400/timeout on one page fetch used to truncate the whole feed
  // (the loop breaks on the first null page). Retry a couple of times with a
  // short backoff so a single blip — throttling under concurrent load, a
  // momentary gateway error — doesn't cut the request short.
  const FETCH_RETRIES = 2
  const RETRY_BASE_MS = 300
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  // Fetch one page of the personalized Discover feed via the OAuth agent.
  // Returns null only after exhausting retries, at which point we have no cursor
  // to continue from and the caller stops.
  const fetchPage = async (cursor?: string): Promise<Page | null> => {
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      try {
        console.log('[fem-feed] Fetching personalized whats-hot page via OAuth Agent...')
        const res = await authedAgent.app.bsky.feed.getFeed({ feed: feedUri, limit: PAGE_SIZE, cursor })
        return { feed: res.data.feed, cursor: res.data.cursor }
      } catch (e: any) {
        // XRPCError carries .status/.error; log both so we can tell a real
        // service rejection (e.g. a bad/too-deep cursor) apart from a gateway or
        // throttle 400 (HTML body, no real error code).
        const status = e?.status ?? e?.statusCode ?? 'n/a'
        const detail = e?.error ?? e?.message ?? e
        console.error(`[fem-feed] Failed to fetch Discover page (attempt ${attempt + 1}/${FETCH_RETRIES + 1}, status ${status}):`, detail)
        if (attempt < FETCH_RETRIES) {
          await sleep(RETRY_BASE_MS * (attempt + 1))
          continue
        }
        return null
      }
    }
    return null
  }

  // Embed names via Jina; result is aligned to input order.
  const embed = async (texts: string[]): Promise<(number[] | undefined)[]> => {
    const response = await (globalThis as any).fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'jina-embeddings-v5-text-small', input: texts, task: 'classification' }),
    })
    if (!response.ok) {
      throw new Error(`Jina Embeddings API error: ${response.status} ${await response.text()}`)
    }
    const result = await response.json()
    return texts.map((_t: string, i: number) => result.data[i]?.embedding)
  }

  // Resolve classifier scores for a set of normalized names, embedding only the
  // ones not already in the cross-request cache.
  const scoreNames = async (names: string[]): Promise<Map<string, number>> => {
    const scores = new Map<string, number>()
    const missSet = new Set<string>()
    for (const n of names) {
      const cached = nameScoreCache.get(n)
      if (cached !== undefined) scores.set(n, cached)
      else missSet.add(n)
    }
    if (missSet.size > 0) {
      const misses = Array.from(missSet)
      const embs = await embed(misses)
      for (let i = 0; i < misses.length; i++) {
        const emb = embs[i]
        if (emb) {
          const score = dotProduct(l2Normalize(emb), clf.w) + clf.b
          scores.set(misses[i], score)
          cacheScore(misses[i], score)
        }
      }
    }
    return scores
  }

  // Prefetch the first page, then pipeline: while we classify page N, page N+1's
  // fetch is already in flight, so per-page wall time is ~max(fetch, embed)
  // instead of fetch+embed. Page fetches are cursor-chained and unavoidably
  // sequential; only the embed step overlaps.
  let pagePromise: Promise<Page | null> = fetchPage(currentCursor)

  for (let loopCount = 1; loopCount <= MAX_LOOPS; loopCount++) {
    const page = await pagePromise
    if (!page) break
    const posts: any[] = page.feed || []
    currentCursor = page.cursor
    if (posts.length === 0) break

    // Kick off the next page fetch now, before spending time on embeddings.
    const canFetchMore = loopCount < MAX_LOOPS && !!page.cursor && finalFeed.length < targetLimit
    pagePromise = canFetchMore ? fetchPage(page.cursor) : Promise.resolve(null)

    const pairs = posts.map((item: any) => ({
      postUri: item.post.uri,
      name: firstName(getUsernameToEmbed(item.post.author)),
    }))
    const uniqueNames = Array.from(new Set(pairs.map((p) => p.name)))
    const toEmbed = uniqueNames.filter((n) => !nameScoreCache.has(n)).length
    console.log(`[fem-feed] Loop ${loopCount}: Fetched ${posts.length} posts, ${uniqueNames.length} unique authors (${toEmbed} to embed, rest cached).`)

    let scores: Map<string, number>
    try {
      scores = await scoreNames(uniqueNames)
    } catch (e) {
      console.error('Failed to embed usernames via Jina API:', e)
      break
    }

    let loopAccepted = 0
    for (const pair of pairs) {
      const score = scores.get(pair.name)
      if (score !== undefined && score > SCORE_THRESHOLD) {
        finalFeed.push({ post: pair.postUri })
        loopAccepted++
      }
    }
    console.log(`[fem-feed] Loop ${loopCount}: Retained ${loopAccepted} female-authored posts (Total so far: ${finalFeed.length}/${targetLimit}).`)

    if (finalFeed.length >= targetLimit) break
    if (!page.cursor) {
      console.log(`[fem-feed] Loop ${loopCount}: No more cursor from AppView, breaking loop.`)
      break
    }
  }

  console.log(`[fem-feed] Finished processing. Returning ${finalFeed.length} posts to client.`)

  return {
    cursor: currentCursor,
    feed: finalFeed,
  }
}
