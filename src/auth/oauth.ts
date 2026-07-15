import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { stateStore, sessionStore } from '../db/oauth'
import dotenv from 'dotenv'

dotenv.config()

const publicUrl = `https://${process.env.FEEDGEN_HOSTNAME || 'example.com'}`

// Serialize token refreshes per DID. atproto refresh tokens are single-use and
// rotate on every refresh, so concurrent restore() calls (e.g. the burst of
// getFeedSkeleton requests fired while scrolling) would race to refresh an
// expired token, revoke each other's credentials, and drop the session back to
// the unauthenticated feed. This in-process lock allows one refresh at a time.
// NOTE: in-process only — a multi-instance deployment needs a shared lock.
const locks = new Map<string, Promise<unknown>>()
const requestLock = <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
  const prev = (locks.get(name) ?? Promise.resolve()) as Promise<unknown>
  const next = prev.then(() => fn(), () => fn())
  locks.set(name, next.then(() => {}, () => {}))
  return next
}

// Fetching a generator-backed feed (whats-hot/Discover) via app.bsky.feed.getFeed
// makes the AppView call that generator's getFeedSkeleton on the user's behalf, so the
// token needs BOTH methods scoped against the AppView aud.
export const OAUTH_SCOPE =
  'atproto' +
  ' rpc:app.bsky.feed.getFeed?aud=did:web:api.bsky.app#bsky_appview' +
  ' rpc:app.bsky.feed.getFeedSkeleton?aud=did:web:api.bsky.app#bsky_appview'

export const oauthClient = new NodeOAuthClient({
  clientMetadata: {
    client_name: 'Fem Feed Generator',
    client_id: publicUrl === 'https://example.com'
      ? `http://localhost?redirect_uri=${encodeURIComponent('http://127.0.0.1:3000/oauth/callback')}&scope=${encodeURIComponent(OAUTH_SCOPE)}`
      : `${publicUrl}/client-metadata-v4.json`,
    client_uri: publicUrl,
    redirect_uris: [
      publicUrl === 'https://example.com'
        ? 'http://127.0.0.1:3000/oauth/callback'
        : `${publicUrl}/oauth/callback`
    ],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  },
  stateStore,
  sessionStore,
  requestLock,
})
