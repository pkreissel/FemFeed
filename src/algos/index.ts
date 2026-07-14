import { AppContext } from '../config'
import {
  QueryParams,
  OutputSchema as AlgoOutput,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import express from 'express'
import * as femFeed from './fem-feed'

type AlgoHandler = (
  ctx: AppContext,
  params: QueryParams,
  req?: express.Request,
) => Promise<AlgoOutput>

const algos: Record<string, AlgoHandler> = {
  [femFeed.shortname]: femFeed.handler,
}

export default algos
