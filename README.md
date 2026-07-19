# reindexly

> Resumable, safe **zero-downtime reindexing** for OpenSearch & Elasticsearch.

Rebuild a search index with a new mapping while your app keeps reading and writing - with no downtime. reindexly builds the new index and catches it up first, and only then moves traffic over by switching an alias. The switch is instant, so no request ever hits a missing or half-built index.

You get the **engine** (a persisted state machine) and three **ports** to fill in. You provide three small pieces - how to talk to your cluster over HTTP, where to save progress, and how to read changed rows from your database - and the engine runs the rest. If the process crashes, it continues from where it stopped.

```
INDEX_CREATION ─► INITIAL_REINDEXING ─► MANUAL_INDEXING ─► ALIAS_UPDATE ─► FINAL_MANUAL_INDEXING ─► COMPLETED
                                                                                            └► (FAILED)
```

---

## When should you use this?

The most reliable way to reindex with zero downtime is a **Change Data Capture (CDC)** pipeline. A tool like **Debezium** reads your database's change log and publishes every insert, update, and delete to **Kafka** as an ordered stream of events. One consumer keeps the live index up to date. When you need to reindex, a second consumer replays the whole stream from the start to build the new index, catches up to the live one, and then you switch the alias. Because every change is an ordered event, this handles inserts, updates, and deletes correctly, with no race conditions.

That approach is the gold standard, but it needs real infrastructure: a Kafka cluster, Debezium, a schema registry, consumer-group management, and moving all your index writes to be event-driven. For many teams, that is too much to build and run just for an occasional reindex.

**reindexly is for teams that do not have that pipeline.** It gives you safe, zero-downtime reindexing using only your database and your search cluster - no Kafka, no CDC. The main trade-off: it reads changes by timestamp instead of replaying an ordered event log, so it cannot detect hard deletes (see [Trade-offs](#trade-offs)).

---

## Why not just "create, _reindex, swap"?

The simple recipe - create a new index, run `_reindex`, switch the alias - has two problems under live traffic:

- Writes that happen **during** the long `_reindex` are lost.
- If the process crashes, you are left with a half-built index and no record of where to continue.

reindexly fixes both:

- **Catches up from your source of truth** (your database), not from a copy of the old index. So writes made during the rebuild are not lost.
- **Resumable** - it saves its progress after every step, so a crash does not mean starting over.
- **Idempotent** - every step is safe to run again, which is what makes resuming safe.
- **Instant switch** - the only change-over is moving an alias, which the cluster does atomically.

---

## How it works

Clients always read and write through an **alias**. The real index behind that alias is switched in one atomic step.

1. **`INDEX_CREATION`** - create the new index (`target`) next to the live one (`source`), using the new mapping.
2. **`INITIAL_REINDEXING`** - start a server-side async `_reindex` to copy `source → target` in bulk. The engine saves a timestamp first, then waits for the copy task to finish.
3. **`MANUAL_INDEXING`** - repeatedly read rows changed since that timestamp **from your database** and write them into `target`. This loops until only a few documents are left. The old index still serves all live traffic.
4. **`ALIAS_UPDATE`** - switch the alias from `source` to `target` in one atomic step. This is the only moment traffic moves, and it causes no downtime.
5. **`FINAL_MANUAL_INDEXING`** - one more sync to copy anything that changed between the last catch-up and the switch.

The catch-up loop stops based on **how many documents are still behind**, not on a fixed time.

---

## Install

```sh
npm install reindexly
# or
yarn add reindexly
```

**Requirements:** Node.js 18 or newer, and an Elasticsearch- or OpenSearch-compatible cluster. The built-in `IndexApi` uses the shared `_reindex` / `_tasks` / `_aliases` REST API, so it works with Elasticsearch 7/8, OpenSearch 1/2/3, and the AWS managed versions.

reindexly is written in TypeScript. The published types are compiled straight from the source (not inferred from JSDoc), so what you see in your editor is exactly what the library implements - no separate `@types` package needed.

---

## The three ports you implement

| Port | You implement | What it does |
|------|---------------|--------------|
| **`IndexApi`** | `_request(method, path, body, query)` | Sends HTTP requests to your cluster. `method` is typed as `HttpMethod` (`'get' \| 'post' \| 'put'`). The class builds every `_reindex`/`_tasks`/`_aliases` request and reads cluster errors; you only send the request and return the response. On failure, throw anything shaped like `IndexApiErrorLike` (`{ message, status, body }`) - or just throw the ready-made `IndexApi.Errors.IndexApiError`. |
| **`Repository`** | `_init`, `_update`, `_acquire`, `_release`, `_getConfig` | Saves the engine's progress and provides a single-writer lock. **`_acquire` must be atomic** (compare-and-set) - it is the lock that keeps reindexes one at a time. The engine takes the lock first, so `_init`/`_update` just persist (return nothing; throw on failure). |
| **`PostSynchronizer`** | `_sync(reindexing)` | Reads rows changed since the last checkpoint from your database and writes them into the new index. Returns how many it wrote. |

---

## Quick start

### 1. Talk to the cluster - `IndexApi`

```ts
import axios from 'axios'
import { IndexApi, HttpMethod } from 'reindexly'

const client = axios.create({
  baseURL: process.env.OPENSEARCH_URL,
  auth   : { username: process.env.OPENSEARCH_USER!, password: process.env.OPENSEARCH_PASSWORD! },
})

class AxiosIndexApi extends IndexApi {
  protected async _request(method: HttpMethod, path: string, body?: object, query?: object): Promise<unknown> {
    try {
      const { data } = await client.request({ method, url: path, params: query, data: body })

      return data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        // ready-made error class - IndexApi classifies IndexApiErrorLike-shaped
        // errors into IndexAlreadyExistsError/ReindexingError for you
        throw new IndexApi.Errors.IndexApiError(err.message, err.response.status, err.response.data)
      }

      throw err
    }
  }
}
```

### 2. Save progress and lock - `Repository`

This example uses Redis. `_init`/`_update` persist state and return nothing - throw your own error if a write fails. The engine itself checks whether a reindex is already in progress (it reads `_getConfig` under the lock), so `_init` just writes. The only part that must be atomic is the lock: `SET ... NX` lets just one worker win.

```ts
import { createClient } from 'redis'
import { Repository, Reindexing, ISODateString } from 'reindexly'

const redis = createClient()
const STATE = 'reindex:state'
const LOCK  = 'reindex:lock'

class RedisRepository extends Repository {
  // Persist the new reindexing record. The engine has already verified - under
  // the lock - that no active reindexing exists, so this just writes.
  protected async _init(reindexing: Reindexing): Promise<void> {
    await redis.set(STATE, JSON.stringify(reindexing))
  }

  // Merge a partial change into the saved state. Throw your own error on failure.
  protected async _update(changes: Partial<Reindexing>): Promise<void> {
    const stored = await this._getConfig()

    if (!stored) {
      throw new Error('No reindexing in progress to update')
    }

    await redis.set(STATE, JSON.stringify({ ...stored, ...changes }))
  }

  protected async _getConfig(): Promise<Reindexing | null> {
    const raw = await redis.get(STATE)

    return raw ? JSON.parse(raw) : null
  }

  // SET ... NX is an atomic compare-and-set: only one worker can take the lock.
  protected async _acquire(date: ISODateString): Promise<boolean> {
    return await redis.set(LOCK, date, { NX: true }) === 'OK'
  }

  protected async _release(): Promise<void> {
    await redis.del(LOCK)
  }
}
```

### 3. Copy the changes - `PostSynchronizer`

```ts
import { PostSynchronizer, Reindexing } from 'reindexly'

class OrdersSynchronizer extends PostSynchronizer {
  // stop catching up once a sync writes 1000 docs or fewer (default: 500)
  public ACCEPTABLE_BACKLOG = 1000

  protected async _sync(reindexing: Required<Reindexing>): Promise<number> {
    // Go back a little to cover clock differences and in-flight writes.
    // Re-reading is free because indexing is an upsert by id.
    const since = new Date(new Date(reindexing.lastSyncedDate).getTime() - 60_000)

    const rows = await db.query('SELECT * FROM orders WHERE updated_at > $1', [since])

    await bulkUpsert(reindexing.target, rows) // write into the NEW index, keyed by document id

    return rows.length // how many were written → controls when to stop
  }
}
```

### 4. Run it

```ts
import { Reindexer, InitialReindexing } from 'reindexly'

const reindexer = new Reindexer(
  new RedisRepository(),
  new AxiosIndexApi(),
  new OrdersSynchronizer(),
)

const input: InitialReindexing = {
  alias  : 'orders',     // the alias clients read/write through
  source : 'orders_v1',  // the index currently behind the alias
  target : 'orders_v2',  // the new index to build
  mapping: {
    properties: {
      id       : { type: 'keyword' },
      createdAt: { type: 'date' },
      // ...the new mapping
    },
  },

  // optional:
  // query         : { term: { country: 'AE' } }, // reindex only a subset
  // painlessScript: 'ctx._source.x = 1',          // transform during _reindex
  // pipeline      : 'my-ingest-pipeline',
}

await reindexer.reindex(input)
```

If the process stops at any point, **call `reindexer.reindex(...)` again with the same config**. It continues from the last saved step. You usually work out `source` and `target` yourself first (for example, read the alias and increase the version number).

---

## Exports

Everything below is importable directly from `'reindexly'`.

**Classes**

| Export | Description |
|--------|-------------|
| `IndexApi` | Abstract - implement `_request`. See [API](#api). |
| `Repository` | Abstract - implement `_init`/`_update`/`_acquire`/`_release`/`_getConfig`. |
| `PostSynchronizer` | Abstract - implement `_sync`. |
| `Reindexer` | Concrete - the engine. `new Reindexer(repository, indexApi, postSynchronizer)`. |

**Values**

| Export | Description |
|--------|-------------|
| `Stage` | Enum of state-machine stages (`INDEX_CREATION`, `INITIAL_REINDEXING`, `MANUAL_INDEXING`, `ALIAS_UPDATE`, `FINAL_MANUAL_INDEXING`, `REINDEXING_COMPLETED`, `REINDEXING_FAILED`). Also reachable as `Repository.Stage` - same object. |

**Types**

| Export | Description |
|--------|-------------|
| `Reindexing` | Full persisted record: `InitialReindexing` plus the progress fields (`stage`, `taskId?`, `lastSyncedDate?`). What `Repository`'s hooks receive; `PostSynchronizer._sync` receives `Required<Reindexing>` - `taskId`/`lastSyncedDate` are always set by the time it runs. |
| `InitialReindexing` | The input you pass to `reindexer.reindex(...)` - `alias`, `source`, `target`, `mapping`, `query`, `painlessScript`, `pipeline`. |
| `HttpMethod` | `'get' \| 'post' \| 'put'` - the method type `IndexApi#_request` receives. |
| `TaskResponse` | Shape of a `_tasks/{id}` response, as returned by `IndexApi#getTask`. |
| `IndexApiErrorLike` | `{ message, status, body }` - the shape `_request` must throw on failure for `IndexApi` to classify cluster errors. `IndexApi.Errors.IndexApiError` implements it, but any object with this shape works. |
| `ISODateString` | Branded `string` type for the ISO timestamps stored in `Reindexing.lastSyncedDate` and passed to `Repository#_acquire`. |

**Nested (reached through the classes above, not top-level exports)**

| Export | Description |
|--------|-------------|
| `IndexApi.Errors.IndexAlreadyExistsError` | Thrown internally when `createIndex` resumes into an already-existing target index; swallowed by the engine (idempotent resume). |
| `IndexApi.Errors.ReindexingError` | Thrown internally when a reindex task is lost or completes with failures. |
| `IndexApi.Errors.IndexApiError` | The ready-made class implementing `IndexApiErrorLike` - throw `new IndexApi.Errors.IndexApiError(message, status, body)` from your `_request` implementation. |
| `Reindexer.Errors.ReindexingNotResumableError` | Thrown (and the run marked `FAILED`) when a failure cannot be resumed. |

---

## API

### `new Reindexer(repository, indexApi, postSynchronizer)`

Creates the engine. Each argument must be an instance of the matching base class (this is checked).

#### `reindexer.reindex(config: InitialReindexing) → Promise<void>`

Runs (or resumes) a reindex. You pass the input fields; the engine fills in and persists the `auto` ones as it advances through the stages (these are what you read back from `_getConfig`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `alias` | `string` | ✅ | The alias clients read/write through; switched at the end. |
| `source` | `string` | ✅ | The index currently behind the alias. |
| `target` | `string` | ✅ | The new index to build. |
| `mapping` | `object` | ✅ | The mapping for the new index. |
| `query` | `object` | - | Reindex only a subset. |
| `painlessScript` | `string` | - | Painless transform applied during `_reindex`. |
| `pipeline` | `string` | - | Ingest pipeline for the `_reindex`. |
| `stage` | `Stage` | auto | Current state-machine stage; a resumed run continues from here. |
| `taskId` | `string` | auto | Id of the async `_reindex` task, persisted so a resumed run re-attaches instead of re-copying. |
| `lastSyncedDate` | `ISODateString` | auto | ISO timestamp checkpoint; the next catch-up reads source rows changed after it. |

#### `Reindexer.Errors.ReindexingNotResumableError`

Thrown (and the run marked `FAILED`) when a failure cannot be resumed.

### `Repository` (abstract)

Implement the `_`-prefixed hooks; the public methods are provided for you.

- `_init(reindexing: Reindexing) → Promise<void>` - persist the new reindexing record. Throw on failure.
- `_update(changes: Partial<Reindexing>) → Promise<void>` - merge a partial change into the saved state. Throw on failure.
- `_acquire(date: ISODateString) → Promise<boolean>` - atomically take the lock.
- `_release() → Promise<void>`
- `_getConfig() → Promise<Reindexing | null>` - the saved state, or `null`.

Statics: `Repository.Stage` (same enum as the top-level `Stage` export).

### `IndexApi` (abstract)

- `_request(method: HttpMethod, path: string, body?: object, query?: object) → Promise<unknown>` - the only thing you implement. On a non-2xx response, throw an error shaped like `IndexApiErrorLike` (`message`, `status`, the cluster's error `body`) - typically `new IndexApi.Errors.IndexApiError(message, status, body)`.

Statics: `IndexApi.Errors` (`IndexAlreadyExistsError`, `ReindexingError`, `IndexApiError`).

### `PostSynchronizer` (abstract)

- `_sync(reindexing: Required<Reindexing>) → Promise<number>` - write documents changed since `reindexing.lastSyncedDate` into `reindexing.target`; return the count.
- `ACCEPTABLE_BACKLOG` (default `500`) - the catch-up loop stops once a sync writes this many documents or fewer. Override per instance to tune.

---

## Trade-offs

- **Deletes are not copied.** The catch-up reads *created and updated* rows from your database. Rows that are **hard-deleted** stay in the new index as stale documents until the next full reindex. Use soft-deletes (so a delete looks like an update), or run a separate clean-up, if this matters to you.
- **One reindex at a time.** The advisory lock (`_acquire`) serializes concurrent runs, and the engine won't start a *different* reindex while one is in progress - it resumes the active one if the config matches, and rejects a mismatching config.
- **Stopping is based on backlog, not time.** This is predictable when the write rate is steady. A long burst of writes above `ACCEPTABLE_BACKLOG` can make the catch-up loop run longer.

---

## License

ISC
