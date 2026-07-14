import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { stateStore, sessionStore } from '../db/oauth'
import dotenv from 'dotenv'

dotenv.config()

const publicUrl = `https://${process.env.FEEDGEN_HOSTNAME || 'example.com'}`

export const oauthClient = new NodeOAuthClient({
  clientMetadata: {
    client_name: 'Fem Feed Generator',
    client_id: publicUrl === 'https://example.com' 
      ? `http://localhost?redirect_uri=${encodeURIComponent('http://127.0.0.1:3000/oauth/callback')}&scope=${encodeURIComponent('atproto transition:generic')}` 
      : `${publicUrl}/client-metadata-v2.json`,
    client_uri: publicUrl,
    redirect_uris: [
      publicUrl === 'https://example.com' 
        ? 'http://127.0.0.1:3000/oauth/callback' 
        : `${publicUrl}/oauth/callback`
    ],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  },
  stateStore,
  sessionStore,
})
