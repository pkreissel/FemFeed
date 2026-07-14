import { DidResolver } from '@atproto/identity'

export type AppContext = {
  didResolver: DidResolver
  cfg: Config
}

export type Config = {
  port: number
  listenhost: string
  hostname: string
  serviceDid: string
  publisherDid: string
}
