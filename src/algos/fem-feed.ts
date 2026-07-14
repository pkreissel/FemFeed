import fs from 'fs'
import path from 'path'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import express from 'express'
import { Agent } from '@atproto/api'
import { oauthClient } from '../auth/oauth'
import { validateAuth } from '../auth'

export const shortname = 'fem-feed'

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
  } else {
    console.log('[fem-feed] Unauthenticated request, using global feed')
  }

  console.log(`[fem-feed] Starting feed generation. Target limit: ${params.limit}, Cursor: ${params.cursor || 'none'}`)

  // 1. Fetch the discover (whats-hot) feed from AppView
  const feedUri = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'
  
  const targetLimit = params.limit ?? 50
  let currentCursor = params.cursor
  let finalFeed: { post: string }[] = []
  
  let loopCount = 0
  const MAX_LOOPS = 5 // prevent infinite loops, fetch up to 5 pages (500 items)

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }
  // Remove the authorization header from the raw fetch request since it's an AppView service JWT, not an access token
  
  while (finalFeed.length < targetLimit && loopCount < MAX_LOOPS) {
    loopCount++

    let feedData: any
    try {
      if (agent) {
        // Authenticated request via Agent!
        console.log(`[fem-feed] Loop ${loopCount}: Fetching personalized whats-hot feed via OAuth Agent...`)
        const res = await agent.app.bsky.feed.getFeed({
          feed: feedUri,
          limit: 100,
          cursor: currentCursor,
        })
        feedData = {
          feed: res.data.feed,
          cursor: res.data.cursor,
        }
      } else {
        // Unauthenticated fallback
        console.log(`[fem-feed] Loop ${loopCount}: Fetching global whats-hot feed via unauthenticated fetch...`)
        const url = new URL('https://api.bsky.app/xrpc/app.bsky.feed.getFeed')
        url.searchParams.set('feed', feedUri)
        url.searchParams.set('limit', '100')
        if (currentCursor) {
          url.searchParams.set('cursor', currentCursor)
        }
        const res = await (globalThis as any).fetch(url.toString(), { method: 'GET', headers })
        if (!res.ok) {
          const err = await res.text()
          throw new Error(`Status ${res.status}: ${err}`)
        }
        feedData = await res.json()
      }
    } catch (e) {
      console.error('Failed to fetch Discover feed from AppView:', e)
      break
    }

    const appViewPosts = feedData.feed || []
    currentCursor = feedData.cursor

    if (appViewPosts.length === 0) {
      break
    }

    // 2. Extract usernames/names to embed
    const postAuthorPairs = appViewPosts.map((item: any) => {
      return {
        postUri: item.post.uri,
        username: getUsernameToEmbed(item.post.author),
      }
    })

    const uniqueUsernames: string[] = Array.from(new Set(postAuthorPairs.map((p: any) => p.username as string)))
    console.log(`[fem-feed] Loop ${loopCount}: Fetched ${appViewPosts.length} posts, ${uniqueUsernames.length} unique authors to classify.`)

    // 3. Batch embed usernames using Jina Embeddings API
    let embeddingMap: Record<string, number[]> = {}
    try {
      const response = await (globalThis as any).fetch('https://api.jina.ai/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'jina-embeddings-v5-text-small',
          input: uniqueUsernames,
          task: 'classification',
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Jina Embeddings API error: ${response.status} ${errorText}`)
      }

      const result = await response.json()
      for (let i = 0; i < uniqueUsernames.length; i++) {
        const emb = result.data[i]?.embedding
        if (emb) {
          embeddingMap[uniqueUsernames[i]] = l2Normalize(emb)
        }
      }
    } catch (e) {
      console.error('Failed to embed usernames via Jina API:', e)
      break
    }

    let loopAccepted = 0
    for (const pair of postAuthorPairs) {
      const emb = embeddingMap[pair.username]
      if (emb) {
        const score = dotProduct(emb, classifier.w) + classifier.b
        // If score > 0, logistic regression classifies it as female
        if (score > 0) {
          finalFeed.push({ post: pair.postUri })
          loopAccepted++
        }
      }
    }

    console.log(`[fem-feed] Loop ${loopCount}: Retained ${loopAccepted} female-authored posts (Total so far: ${finalFeed.length}/${targetLimit})`)

    if (!currentCursor) {
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
