import fs from 'fs'
import path from 'path'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import express from 'express'

export const shortname = 'fem-feed'

// Read precomputed male-female direction vector from direction.json
let directionVector: number[] | null = null
try {
  const dirPath = path.join(process.cwd(), 'src/direction.json')
  if (fs.existsSync(dirPath)) {
    directionVector = JSON.parse(fs.readFileSync(dirPath, 'utf8'))
  } else {
    console.warn(`direction.json not found at ${dirPath}. Please run npm run compute-direction first.`)
  }
} catch (e) {
  console.error('Failed to load direction vector:', e)
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

  if (!directionVector) {
    console.error('direction.json is not loaded or missing. Run npm run compute-direction first.')
    return { feed: [] }
  }

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
  if (req?.headers.authorization) {
    headers['Authorization'] = req.headers.authorization
  }

  while (finalFeed.length < targetLimit && loopCount < MAX_LOOPS) {
    loopCount++

    const url = new URL('https://api.bsky.app/xrpc/app.bsky.feed.getFeed')
    url.searchParams.set('feed', feedUri)
    url.searchParams.set('limit', '100') // fetch maximum allowed to get a good batch of posts to filter
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor)
    }

    let feedData: any
    try {
      const res = await (globalThis as any).fetch(url.toString(), { method: 'GET', headers })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Status ${res.status}: ${err}`)
      }
      feedData = await res.json()
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

    // 4. Check each post author's username embedding against the direction vector
    for (const pair of postAuthorPairs) {
      const emb = embeddingMap[pair.username]
      if (emb) {
        const similarity = dotProduct(emb, directionVector)
        // If similarity > 0, it lies on the female side of the axis
        if (similarity > 0) {
          finalFeed.push({ post: pair.postUri })
        }
      }
    }

    if (!currentCursor) {
      break
    }
  }

  return {
    cursor: currentCursor,
    feed: finalFeed,
  }
}
