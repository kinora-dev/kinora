import type { NormTest, RunIncident, RunReport, RunSummary, TestHistory } from '../contracts/kinora'
import { z } from 'zod'
import { countsSchema, normTestSchema, runIncidentSchema, runReportSchema, runSummarySchema, SCHEMA_VERSION, testHistorySchema } from '../contracts/kinora'
import { IngestError, toIngestError } from './ingest-client'

export interface ReadClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof globalThis.fetch
}

export interface ProjectOverview {
  id: string
  name: string
  description?: string
  latestRun: RunSummary | null
}

export interface RunFailures {
  runId: string
  startedAt: string
  counts: RunReport['counts']
  // The run is an environment incident: its failures come from the app or browser being down.
  incident?: RunIncident
  failures: NormTest[]
}

const projectsResponseSchema = z.object({
  projects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    latestRun: runSummarySchema.nullable(),
  })),
})

const runsResponseSchema = z.object({ runs: z.array(runSummarySchema) })

const failuresResponseSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  counts: countsSchema,
  incident: runIncidentSchema.optional(),
  failures: z.array(normTestSchema),
})

const historyResponseSchema = z.object({ histories: z.array(testHistorySchema) })

// Typed client over the API-key read API (`GET /api/v1/*`). Same auth as the ingest client; used by
// the MCP server so agents can pull last-run failures, run reports, and per-test history.
export function createReadClient(opts: ReadClientOptions) {
  let end = opts.baseUrl.length
  while (end > 0 && opts.baseUrl[end - 1] === '/')
    end--
  const base = `${opts.baseUrl.slice(0, end)}/api/v1`
  const doFetch = opts.fetch ?? globalThis.fetch
  const headers = { authorization: `Bearer ${opts.token}` }

  async function getRaw(path: string): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, { headers })
    if (!res.ok)
      throw await toIngestError(res, `kinora request failed (${res.status})`)
    return res.json()
  }

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(await getRaw(path))
  }

  const project = (slug: string) => `/projects/${encodeURIComponent(slug)}`

  return {
    async listProjects(): Promise<ProjectOverview[]> {
      return (await get(`/projects`, projectsResponseSchema)).projects
    },

    async getRuns(slug: string, limit?: number): Promise<RunSummary[]> {
      const q = limit ? `?limit=${limit}` : ''
      return (await get(`${project(slug)}/runs${q}`, runsResponseSchema)).runs
    },

    // Check the wire schema version before parsing so a version skew (latest npx client vs older
    // self-host server) fails with a clear message, not an opaque ZodError.
    async getRun(slug: string, runId = 'latest'): Promise<RunReport> {
      const raw = await getRaw(`${project(slug)}/runs/${encodeURIComponent(runId)}`)
      const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion
      if (version !== SCHEMA_VERSION)
        throw new IngestError(409, `report schema v${String(version)} from server != client v${SCHEMA_VERSION}; update your kinora server or pin @kinora/mcp to a matching version`)
      return runReportSchema.parse(raw)
    },

    getFailures(slug: string, runId = 'latest'): Promise<RunFailures> {
      return get(`${project(slug)}/failures?runId=${encodeURIComponent(runId)}`, failuresResponseSchema)
    },

    async getHistory(slug: string, testKey?: string): Promise<TestHistory[]> {
      const q = testKey ? `?testKey=${encodeURIComponent(testKey)}` : ''
      return (await get(`${project(slug)}/history${q}`, historyResponseSchema)).histories
    },
  }
}
