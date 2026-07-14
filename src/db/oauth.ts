import { createClient } from '@libsql/client'
import { NodeSavedState, NodeSavedSession, NodeSavedStateStore, NodeSavedSessionStore } from '@atproto/oauth-client-node'
import dotenv from 'dotenv'

dotenv.config()

export const db = createClient({
  url: process.env.BUNNY_DATABASE_URL || 'file:./local.db',
  authToken: process.env.BUNNY_DATABASE_AUTH_TOKEN,
})

export async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS auth_state (
      key TEXT PRIMARY KEY,
      state_json TEXT NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS auth_session (
      did TEXT PRIMARY KEY,
      session_json TEXT NOT NULL
    )
  `)
}

export const stateStore: NodeSavedStateStore = {
  async get(key: string): Promise<NodeSavedState | undefined> {
    const res = await db.execute({
      sql: 'SELECT state_json FROM auth_state WHERE key = ?',
      args: [key],
    })
    if (res.rows.length === 0) return undefined
    return JSON.parse(res.rows[0].state_json as string) as NodeSavedState
  },
  async set(key: string, value: NodeSavedState): Promise<void> {
    await db.execute({
      sql: 'INSERT INTO auth_state (key, state_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET state_json = excluded.state_json',
      args: [key, JSON.stringify(value)],
    })
  },
  async del(key: string): Promise<void> {
    await db.execute({
      sql: 'DELETE FROM auth_state WHERE key = ?',
      args: [key],
    })
  }
}

export const sessionStore: NodeSavedSessionStore = {
  async get(did: string): Promise<NodeSavedSession | undefined> {
    const res = await db.execute({
      sql: 'SELECT session_json FROM auth_session WHERE did = ?',
      args: [did],
    })
    if (res.rows.length === 0) return undefined
    return JSON.parse(res.rows[0].session_json as string) as NodeSavedSession
  },
  async set(did: string, value: NodeSavedSession): Promise<void> {
    await db.execute({
      sql: 'INSERT INTO auth_session (did, session_json) VALUES (?, ?) ON CONFLICT (did) DO UPDATE SET session_json = excluded.session_json',
      args: [did, JSON.stringify(value)],
    })
  },
  async del(did: string): Promise<void> {
    await db.execute({
      sql: 'DELETE FROM auth_session WHERE did = ?',
      args: [did],
    })
  }
}
