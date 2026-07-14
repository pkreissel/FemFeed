import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config()

const apiKey = process.env.JINA_API_KEY
if (!apiKey) {
  console.error('JINA_API_KEY is not configured in .env')
  process.exit(1)
}

// Load classifier weights and bias
const dirPath = path.join(process.cwd(), 'src/classifier.json')
let classifier: { w: number[], b: number }
try {
  classifier = JSON.parse(fs.readFileSync(dirPath, 'utf8'))
} catch (e) {
  console.error('Failed to load classifier:', e)
  process.exit(1)
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

async function run() {
  console.log('Fetching a batch of posts from Discover feed (proxy for firehose)...')
  
  const feedUri = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'
  const url = new URL('https://api.bsky.app/xrpc/app.bsky.feed.getFeed')
  url.searchParams.set('feed', feedUri)
  url.searchParams.set('limit', '100') // Fetch 100 posts

  const res = await fetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } })
  if (!res.ok) {
    console.error('Failed to fetch from AppView', await res.text())
    process.exit(1)
  }

  const feedData: any = await res.json()
  const posts = feedData.feed || []

  if (posts.length === 0) {
    console.log('No posts found.')
    return
  }

  const authorsToEmbed = posts.map((item: any) => ({
    handle: item.post.author.handle,
    displayName: item.post.author.displayName,
    textToEmbed: getUsernameToEmbed(item.post.author),
    text: item.post.record.text
  }))

  const uniqueUsernames: string[] = Array.from(new Set(authorsToEmbed.map((p: any) => p.textToEmbed as string)))

  console.log(`Embedding ${uniqueUsernames.length} unique usernames using Jina API...`)

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
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
    console.error('Jina API error:', await response.text())
    process.exit(1)
  }

  const result: any = await response.json()
  let embeddingMap: Record<string, number[]> = {}
  for (let i = 0; i < uniqueUsernames.length; i++) {
    const emb = result.data[i]?.embedding
    if (emb) {
      embeddingMap[uniqueUsernames[i]] = l2Normalize(emb)
    }
  }

  console.log('\n--- RESULTS ---')
  console.log(String('User').padEnd(30) + ' | ' + String('Score').padEnd(8) + ' | ' + 'Classification')
  console.log('-'.repeat(60))

  for (const author of authorsToEmbed) {
    const emb = embeddingMap[author.textToEmbed]
    if (emb) {
      const score = dotProduct(emb, classifier.w) + classifier.b
      const classification = score > 0 ? 'Female (Included)' : 'Male (Excluded)'
      const scoreStr = score.toFixed(3)
      const nameStr = (author.textToEmbed.length > 28 ? author.textToEmbed.substring(0, 25) + '...' : author.textToEmbed).padEnd(30)
      console.log(`${nameStr} | ${scoreStr.padEnd(8)} | ${classification}`)
    }
  }
}

run().catch(console.error)
