import http from 'http'
import events from 'events'
import express from 'express'
import { DidResolver, MemoryCache } from '@atproto/identity'
import { createServer } from './lexicon'
import feedGeneration from './methods/feed-generation'
import describeGenerator from './methods/describe-generator'
import { AppContext, Config } from './config'
import wellKnown from './well-known'
import { oauthClient, OAUTH_SCOPE } from './auth/oauth'
import { initDb } from './db/oauth'

export class FeedGenerator {
  public app: express.Application
  public server?: http.Server
  public cfg: Config

  constructor(
    app: express.Application,
    cfg: Config,
  ) {
    this.app = app
    this.cfg = cfg
  }

  static create(cfg: Config) {
    const app = express()
    app.set('trust proxy', true)

    const didCache = new MemoryCache()
    const didResolver = new DidResolver({
      plcUrl: 'https://plc.directory',
      didCache,
    })

    const server = createServer({
      validateResponse: true,
      payload: {
        jsonLimit: 100 * 1024, // 100kb
        textLimit: 100 * 1024, // 100kb
        blobLimit: 5 * 1024 * 1024, // 5mb
      },
    })
    const ctx: AppContext = {
      didResolver,
      cfg,
    }
    feedGeneration(server, ctx)
    describeGenerator(server, ctx)
    app.use(server.xrpc.router)
    app.use(wellKnown(ctx))

    app.get(['/client-metadata.json', '/client-metadata-v2.json', '/client-metadata-v3.json', '/client-metadata-v4.json'], (req, res) => {
      res.json(oauthClient.clientMetadata)
    })

    app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Login to FemFeed</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #000; color: #fff; margin: 0; }
            .container { text-align: center; background: #111; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; width: 100%; }
            input { padding: 12px; font-size: 16px; border-radius: 6px; border: 1px solid #333; background: #222; color: #fff; margin-bottom: 20px; width: 90%; box-sizing: border-box; }
            button { background: #0085ff; color: #fff; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer; width: 90%; }
            button:hover { background: #006bce; }
            h1 { margin-top: 0; font-size: 24px; }
            p { color: #888; margin-bottom: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>FemFeed Personalization</h1>
            <p>Login to connect your Discover feed.</p>
            <form action="/login" method="GET">
              <input type="text" name="handle" placeholder="e.g. alice.bsky.social" required />
              <button type="submit">Login with Bluesky</button>
            </form>
          </div>
        </body>
        </html>
      `)
    })

    app.get('/login', async (req, res) => {
      try {
        const handle = req.query.handle as string
        if (!handle) {
          console.warn('[server] Login request missing handle')
          return res.status(400).send('Handle is required')
        }
        console.log(`[server] Initiating OAuth login for handle: ${handle}`)
        const url = await oauthClient.authorize(handle, { scope: OAUTH_SCOPE })
        res.redirect(url.toString())
      } catch (e) {
        console.error('Login error', e)
        res.status(500).send('Failed to initiate login')
      }
    })

    app.get('/oauth/callback', async (req, res) => {
      try {
        console.log('[server] Received OAuth callback request')
        const params = new URLSearchParams(req.url.split('?')[1])
        const { session } = await oauthClient.callback(params)
        console.log(`[server] OAuth callback successful for DID: ${session.did}`)
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Success</title>
            <style>
              body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #000; color: #fff; }
              .container { text-align: center; background: #111; padding: 40px; border-radius: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>Successfully logged in!</h2>
              <p>Your feed is now personalized.</p>
              <p style="color: #666; font-size: 12px;">DID: ${session.did}</p>
            </div>
          </body>
          </html>
        `)
      } catch (e) {
        console.error('Callback error', e)
        res.status(500).send('Login failed')
      }
    })

    return new FeedGenerator(app, cfg)
  }

  async start(): Promise<http.Server> {
    await initDb()
    this.server = this.app.listen(this.cfg.port, this.cfg.listenhost)
    await events.once(this.server, 'listening')
    return this.server
  }
}

export default FeedGenerator
