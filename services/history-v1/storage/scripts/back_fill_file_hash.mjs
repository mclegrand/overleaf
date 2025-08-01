// @ts-check
import Events from 'node:events'
import fs from 'node:fs'
import Path from 'node:path'
import { performance } from 'node:perf_hooks'
import Stream from 'node:stream'
import { setTimeout } from 'node:timers/promises'
import { ObjectId } from 'mongodb'
import pLimit from 'p-limit'
import logger from '@overleaf/logger'
import {
  batchedUpdate,
  objectIdFromInput,
  renderObjectId,
} from '@overleaf/mongo-utils/batchedUpdate.js'
import OError from '@overleaf/o-error'
import { NotFoundError } from '@overleaf/object-persistor/src/Errors.js'
import {
  BlobStore,
  GLOBAL_BLOBS,
  loadGlobalBlobs,
  getProjectBlobsBatch,
  getStringLengthOfFile,
  makeBlobForFile,
} from '../lib/blob_store/index.js'
import { db } from '../lib/mongodb.js'
import commandLineArgs from 'command-line-args'
import readline from 'node:readline'

// Silence warning.
Events.setMaxListeners(20)

// Enable caching for ObjectId.toString()
ObjectId.cacheHexString = true

/**
 * @typedef {import("overleaf-editor-core").Blob} Blob
 * @typedef {import("perf_hooks").EventLoopUtilization} EventLoopUtilization
 * @typedef {import("mongodb").Collection} Collection
 * @typedef {import("mongodb").Collection<Project>} ProjectsCollection
 * @typedef {import("mongodb").Collection<{project:Project}>} DeletedProjectsCollection
 * @typedef {import("@overleaf/object-persistor/src/PerProjectEncryptedS3Persistor").CachedPerProjectEncryptedS3Persistor} CachedPerProjectEncryptedS3Persistor
 */

/**
 * @typedef {Object} FileRef
 * @property {ObjectId} _id
 * @property {string} hash
 */

/**
 * @typedef {Object} Folder
 * @property {Array<Folder>} folders
 * @property {Array<FileRef>} fileRefs
 */

/**
 * @typedef {Object} DeletedFileRef
 * @property {ObjectId} _id
 * @property {ObjectId} projectId
 * @property {string} hash
 */

/**
 * @typedef {Object} Project
 * @property {ObjectId} _id
 * @property {Array<Folder>} rootFolder
 * @property {{history: {id: (number|string)}}} overleaf
 */

/**
 * @typedef {Object} QueueEntry
 * @property {ProjectContext} ctx
 * @property {string} cacheKey
 * @property {string} [fileId]
 * @property {string} path
 * @property {string} [hash]
 * @property {Blob} [blob]
 */

/**
 * @return {{PROJECT_IDS_FROM: string, PROCESS_HASHED_FILES: boolean, LOGGING_IDENTIFIER: string, BATCH_RANGE_START: string, PROCESS_BLOBS: boolean, BATCH_RANGE_END: string, PROCESS_NON_DELETED_PROJECTS: boolean, PROCESS_DELETED_PROJECTS: boolean}}
 */
function parseArgs() {
  const PUBLIC_LAUNCH_DATE = new Date('2012-01-01T00:00:00Z')
  const args = commandLineArgs([
    { name: 'processNonDeletedProjects', type: String, defaultValue: 'false' },
    { name: 'processDeletedProjects', type: String, defaultValue: 'false' },
    { name: 'processHashedFiles', type: String, defaultValue: 'false' },
    { name: 'processBlobs', type: String, defaultValue: 'true' },
    { name: 'projectIdsFrom', type: String, defaultValue: '' },
    {
      name: 'BATCH_RANGE_START',
      type: String,
      defaultValue: PUBLIC_LAUNCH_DATE.toISOString(),
    },
    {
      name: 'BATCH_RANGE_END',
      type: String,
      defaultValue: new Date().toISOString(),
    },
    { name: 'LOGGING_IDENTIFIER', type: String, defaultValue: '' },
  ])
  /**
   * commandLineArgs cannot handle --foo=false, so go the long way
   * @param {string} name
   * @return {boolean}
   */
  function boolVal(name) {
    const v = args[name]
    if (['true', 'false'].includes(v)) return v === 'true'
    throw new Error(`expected "true" or "false" for boolean option ${name}`)
  }
  const BATCH_RANGE_START = objectIdFromInput(
    args['BATCH_RANGE_START']
  ).toString()
  const BATCH_RANGE_END = objectIdFromInput(args['BATCH_RANGE_END']).toString()
  return {
    PROCESS_NON_DELETED_PROJECTS: boolVal('processNonDeletedProjects'),
    PROCESS_DELETED_PROJECTS: boolVal('processDeletedProjects'),
    PROCESS_BLOBS: boolVal('processBlobs'),
    PROCESS_HASHED_FILES: boolVal('processHashedFiles'),
    BATCH_RANGE_START,
    BATCH_RANGE_END,
    LOGGING_IDENTIFIER: args['LOGGING_IDENTIFIER'] || BATCH_RANGE_START,
    PROJECT_IDS_FROM: args['projectIdsFrom'],
  }
}

const {
  PROCESS_NON_DELETED_PROJECTS,
  PROCESS_DELETED_PROJECTS,
  PROCESS_BLOBS,
  PROCESS_HASHED_FILES,
  BATCH_RANGE_START,
  BATCH_RANGE_END,
  LOGGING_IDENTIFIER,
  PROJECT_IDS_FROM,
} = parseArgs()

// We need to handle the start and end differently as ids of deleted projects are created at time of deletion.
if (process.env.BATCH_RANGE_START || process.env.BATCH_RANGE_END) {
  throw new Error('use --BATCH_RANGE_START and --BATCH_RANGE_END')
}

// Concurrency for downloading from GCS and updating hashes in mongo
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '100', 10)
const CONCURRENT_BATCHES = parseInt(process.env.CONCURRENT_BATCHES || '2', 10)
// Retries for processing a given file
const RETRIES = parseInt(process.env.RETRIES || '10', 10)
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '100', 10)

const RETRY_FILESTORE_404 = process.env.RETRY_FILESTORE_404 === 'true'
const BUFFER_DIR = fs.mkdtempSync(
  process.env.BUFFER_DIR_PREFIX || '/tmp/back_fill_file_hash-'
)
// https://nodejs.org/api/stream.html#streamgetdefaulthighwatermarkobjectmode
const STREAM_HIGH_WATER_MARK = parseInt(
  process.env.STREAM_HIGH_WATER_MARK || (64 * 1024).toString(),
  10
)
const LOGGING_INTERVAL = parseInt(process.env.LOGGING_INTERVAL || '60000', 10)
const SLEEP_BEFORE_EXIT = parseInt(process.env.SLEEP_BEFORE_EXIT || '1000', 10)

// Filestore endpoint location
const FILESTORE_HOST = process.env.FILESTORE_HOST || '127.0.0.1'
const FILESTORE_PORT = process.env.FILESTORE_PORT || '3009'

async function fetchFromFilestore(projectId, fileId) {
  const url = `http://${FILESTORE_HOST}:${FILESTORE_PORT}/project/${projectId}/file/${fileId}`
  const response = await fetch(url)
  if (!response.ok) {
    if (response.status === 404) {
      throw new NotFoundError('file not found in filestore', {
        status: response.status,
      })
    }
    const body = await response.text()
    throw new OError('fetchFromFilestore failed', {
      projectId,
      fileId,
      status: response.status,
      body,
    })
  }
  if (!response.body) {
    throw new OError('fetchFromFilestore response has no body', {
      projectId,
      fileId,
      status: response.status,
    })
  }
  return response.body
}

const projectsCollection = db.collection('projects')
/** @type {ProjectsCollection} */
const typedProjectsCollection = db.collection('projects')
const deletedProjectsCollection = db.collection('deletedProjects')
/** @type {DeletedProjectsCollection} */
const typedDeletedProjectsCollection = db.collection('deletedProjects')

const concurrencyLimit = pLimit(CONCURRENCY)

/**
 * @template T
 * @template V
 * @param {Array<T>} array
 * @param {(arg: T) => Promise<V>} fn
 * @return {Promise<Array<Awaited<V>>>}
 */
async function processConcurrently(array, fn) {
  return await Promise.all(array.map(x => concurrencyLimit(() => fn(x))))
}

const STATS = {
  projects: 0,
  blobs: 0,
  filesWithHash: 0,
  filesWithoutHash: 0,
  filesDuplicated: 0,
  filesRetries: 0,
  filesFailed: 0,
  fileTreeUpdated: 0,
  badFileTrees: 0,
  globalBlobsCount: 0,
  globalBlobsEgress: 0,
  projectDeleted: 0,
  projectHardDeleted: 0,
  fileHardDeleted: 0,
  mongoUpdates: 0,
  readFromGCSCount: 0,
  readFromGCSIngress: 0,
  writeToGCSCount: 0,
  writeToGCSEgress: 0,
}

const processStart = performance.now()
let lastLogTS = processStart
let lastLog = Object.assign({}, STATS)
let lastEventLoopStats = performance.eventLoopUtilization()

/**
 * @param {number} v
 * @param {number} ms
 */
function toMiBPerSecond(v, ms) {
  const ONE_MiB = 1024 * 1024
  return v / ONE_MiB / (ms / 1000)
}

/**
 * @param {any} stats
 * @param {number} ms
 * @return {{readFromGCSThroughputMiBPerSecond: number}}
 */
function bandwidthStats(stats, ms) {
  return {
    readFromGCSThroughputMiBPerSecond: toMiBPerSecond(
      stats.readFromGCSIngress,
      ms
    ),
  }
}

/**
 * @param {EventLoopUtilization} nextEventLoopStats
 * @param {number} now
 * @return {Object}
 */
function computeDiff(nextEventLoopStats, now) {
  const ms = now - lastLogTS
  lastLogTS = now
  const diff = {
    eventLoop: performance.eventLoopUtilization(
      nextEventLoopStats,
      lastEventLoopStats
    ),
  }
  for (const [name, v] of Object.entries(STATS)) {
    diff[name] = v - lastLog[name]
  }
  return Object.assign(diff, bandwidthStats(diff, ms))
}

/**
 * @param {boolean} isLast
 */
function printStats(isLast = false) {
  const now = performance.now()
  const nextEventLoopStats = performance.eventLoopUtilization()
  const logLine = JSON.stringify({
    time: new Date(),
    LOGGING_IDENTIFIER,
    ...STATS,
    ...bandwidthStats(STATS, now - processStart),
    eventLoop: nextEventLoopStats,
    diff: computeDiff(nextEventLoopStats, now),
    deferredBatches: Array.from(deferredBatches.keys()),
  })
  if (isLast) {
    console.warn(logLine)
  } else {
    console.log(logLine)
  }
  lastEventLoopStats = nextEventLoopStats
  lastLog = Object.assign({}, STATS)
}

setInterval(printStats, LOGGING_INTERVAL)

let gracefulShutdownInitiated = false

process.on('SIGINT', handleSignal)
process.on('SIGTERM', handleSignal)

function handleSignal() {
  gracefulShutdownInitiated = true
  console.warn('graceful shutdown initiated, draining queue')
}

/**
 * @param {QueueEntry} entry
 * @return {Promise<string>}
 */
async function processFileWithCleanup(entry) {
  const {
    ctx: { projectId },
    cacheKey,
  } = entry
  const filePath = Path.join(BUFFER_DIR, projectId.toString() + cacheKey)
  try {
    return await processFile(entry, filePath)
  } finally {
    await Promise.all([
      fs.promises.rm(filePath, { force: true }),
      fs.promises.rm(filePath + GZ_SUFFIX, { force: true }),
    ])
  }
}

/**
 * @param {QueueEntry} entry
 * @param {string} filePath
 * @return {Promise<string>}
 */
async function processFile(entry, filePath) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await processFileOnce(entry, filePath)
    } catch (err) {
      if (gracefulShutdownInitiated) throw err
      if (err instanceof NotFoundError) {
        if (!RETRY_FILESTORE_404) {
          throw err // disable retries for not found in filestore bucket case
        }
      }
      STATS.filesRetries++
      const {
        ctx: { projectId },
        fileId,
        hash,
        path,
      } = entry
      logger.warn(
        { err, projectId, fileId, hash, path, attempt },
        'failed to process file, trying again'
      )
      const jitter = Math.random() * RETRY_DELAY_MS
      await setTimeout(RETRY_DELAY_MS + jitter)
    }
  }
  return await processFileOnce(entry, filePath)
}

/**
 * @param {QueueEntry} entry
 * @param {string} filePath
 * @return {Promise<string>}
 */
async function processFileOnce(entry, filePath) {
  const {
    ctx: { projectId, historyId },
    fileId,
  } = entry
  if (entry.hash && entry.ctx.hasCompletedBlob(entry.hash)) {
    // We can enter this case for two identical files in the same project,
    // one with hash, the other without. When the one without hash gets
    // processed first, we can skip downloading the other one we already
    // know the hash of.
    return entry.hash
  }
  const blobStore = new BlobStore(historyId)
  STATS.readFromGCSCount++
  // make a fetch request to filestore itself
  const src = await fetchFromFilestore(projectId, fileId)
  const dst = fs.createWriteStream(filePath, {
    highWaterMark: STREAM_HIGH_WATER_MARK,
  })
  try {
    await Stream.promises.pipeline(src, dst)
  } finally {
    STATS.readFromGCSIngress += dst.bytesWritten
  }
  const blob = await makeBlobForFile(filePath)
  blob.setStringLength(
    await getStringLengthOfFile(blob.getByteLength(), filePath)
  )
  const hash = blob.getHash()
  if (entry.hash && hash !== entry.hash) {
    throw new OError('hash mismatch', { entry, hash })
  }

  if (GLOBAL_BLOBS.has(hash)) {
    STATS.globalBlobsCount++
    STATS.globalBlobsEgress += estimateBlobSize(blob)
    return hash
  }
  if (entry.ctx.hasCompletedBlob(hash)) {
    return hash
  }
  entry.ctx.recordPendingBlob(hash)

  try {
    await uploadBlobToGCS(blobStore, entry, blob, hash, filePath)
    entry.ctx.recordCompletedBlob(hash) // mark upload as completed
  } catch (err) {
    entry.ctx.recordFailedBlob(hash)
    throw err
  }
  return hash
}

/**
 * @param {BlobStore} blobStore
 * @param {QueueEntry} entry
 * @param {Blob} blob
 * @param {string} hash
 * @param {string} filePath
 * @return {Promise<void>}
 */
async function uploadBlobToGCS(blobStore, entry, blob, hash, filePath) {
  if (entry.ctx.getCachedHistoryBlob(hash)) {
    return // fast-path using hint from pre-fetched blobs
  }
  if (!PROCESS_BLOBS) {
    // round trip to postgres/mongo when not pre-fetched
    const blob = await blobStore.getBlob(hash)
    if (blob) {
      entry.ctx.recordHistoryBlob(blob)
      return
    }
  }
  // blob missing in history-v1, create in GCS and persist in postgres/mongo
  STATS.writeToGCSCount++
  STATS.writeToGCSEgress += blob.getByteLength()
  await blobStore.putBlob(filePath, blob)
  entry.ctx.recordHistoryBlob(blob)
}

const GZ_SUFFIX = '.gz'

/**
 * @param {Array<QueueEntry>} files
 * @return {Promise<void>}
 */
async function processFiles(files) {
  await processConcurrently(
    files,
    /**
     * @param {QueueEntry} entry
     * @return {Promise<void>}
     */
    async function (entry) {
      if (gracefulShutdownInitiated) return
      try {
        await entry.ctx.processFile(entry)
      } catch (err) {
        STATS.filesFailed++
        const {
          ctx: { projectId },
          fileId,
          hash,
          path,
        } = entry
        logger.error(
          { err, projectId, fileId, hash, path },
          'failed to process file'
        )
      }
    }
  )
}

/** @type {Map<string, Promise>} */
const deferredBatches = new Map()

async function waitForDeferredQueues() {
  // Wait for ALL pending batches to finish, especially wait for their mongo
  // writes to finish to avoid extra work when resuming the batch.
  const all = await Promise.allSettled(deferredBatches.values())
  // Now that all batches finished, we can throw if needed.
  for (const res of all) {
    if (res.status === 'rejected') {
      throw res.reason
    }
  }
}

/**
 * @param {Array<Project>} batch
 * @param {string} prefix
 */
async function queueNextBatch(batch, prefix = 'rootFolder.0') {
  if (gracefulShutdownInitiated) {
    throw new Error('graceful shutdown: aborting batch processing')
  }

  // Read ids now, the batch will get trimmed by processBatch shortly.
  const start = renderObjectId(batch[0]._id)
  const end = renderObjectId(batch[batch.length - 1]._id)
  const deferred = processBatch(batch, prefix)
    .then(() => {
      console.error(`Actually completed batch ending ${end}`)
    })
    .catch(err => {
      logger.error({ err, start, end }, 'fatal error processing batch')
      throw err
    })
    .finally(() => {
      deferredBatches.delete(end)
    })
  deferredBatches.set(end, deferred)

  if (deferredBatches.size >= CONCURRENT_BATCHES) {
    // Wait for any of the deferred batches to finish before fetching the next.
    // We should never have more than CONCURRENT_BATCHES batches in memory.
    await Promise.race(deferredBatches.values())
  }
}

/**
 * @param {Array<Project>} batch
 * @param {string} prefix
 * @return {Promise<void>}
 */
async function processBatch(batch, prefix = 'rootFolder.0') {
  const { nBlobs, blobs } = await collectProjectBlobs(batch)
  const files = Array.from(findFileInBatch(batch, prefix, blobs))
  STATS.projects += batch.length
  STATS.blobs += nBlobs

  // GC
  batch.length = 0
  blobs.clear()

  // The files are currently ordered by project-id.
  // Order them by file-id ASC then hash ASC to
  // increase the hit rate on the "already processed
  // hash for project" checks.
  files.sort(
    /**
     * @param {QueueEntry} a
     * @param {QueueEntry} b
     * @return {number}
     */
    function (a, b) {
      if (a.fileId && b.fileId) return a.fileId > b.fileId ? 1 : -1
      if (a.hash && b.hash) return a.hash > b.hash ? 1 : -1
      if (a.fileId) return -1
      return 1
    }
  )
  await processFiles(files)
  await processConcurrently(
    files,
    /**
     * @param {QueueEntry} entry
     * @return {Promise<void>}
     */
    async function (entry) {
      await entry.ctx.flushMongoQueues()
    }
  )
}

/**
 * @param {Array<{project: Project}>} batch
 * @return {Promise<void>}
 */
async function handleDeletedFileTreeBatch(batch) {
  await queueNextBatch(
    batch.map(d => d.project),
    'project.rootFolder.0'
  )
}

/**
 * @param {QueueEntry} entry
 * @return {Promise<boolean>}
 */
async function tryUpdateFileRefInMongo(entry) {
  if (entry.path.startsWith('project.')) {
    return await tryUpdateFileRefInMongoInDeletedProject(entry)
  }

  STATS.mongoUpdates++
  const result = await projectsCollection.updateOne(
    {
      _id: entry.ctx.projectId,
      [`${entry.path}._id`]: new ObjectId(entry.fileId),
    },
    {
      $set: { [`${entry.path}.hash`]: entry.hash },
    }
  )
  return result.matchedCount === 1
}

/**
 * @param {QueueEntry} entry
 * @return {Promise<boolean>}
 */
async function tryUpdateFileRefInMongoInDeletedProject(entry) {
  STATS.mongoUpdates++
  const result = await deletedProjectsCollection.updateOne(
    {
      'deleterData.deletedProjectId': entry.ctx.projectId,
      [`${entry.path}._id`]: new ObjectId(entry.fileId),
    },
    {
      $set: { [`${entry.path}.hash`]: entry.hash },
    }
  )
  return result.matchedCount === 1
}

const RETRY_UPDATE_HASH = 100

/**
 * @param {QueueEntry} entry
 * @return {Promise<void>}
 */
async function updateFileRefInMongo(entry) {
  if (await tryUpdateFileRefInMongo(entry)) return

  const { fileId } = entry
  const { projectId } = entry.ctx
  for (let i = 0; i < RETRY_UPDATE_HASH; i++) {
    let prefix = 'rootFolder.0'
    let p = await projectsCollection.findOne(
      { _id: projectId },
      { projection: { rootFolder: 1 } }
    )
    if (!p) {
      STATS.projectDeleted++
      prefix = 'project.rootFolder.0'
      const deletedProject = await deletedProjectsCollection.findOne(
        {
          'deleterData.deletedProjectId': projectId,
          project: { $exists: true },
        },
        { projection: { 'project.rootFolder': 1 } }
      )
      p = deletedProject?.project
      if (!p) {
        STATS.projectHardDeleted++
        console.warn(
          'bug: project hard-deleted while processing',
          projectId,
          fileId
        )
        return
      }
    }
    let found = false
    for (const e of findFiles(entry.ctx, p.rootFolder[0], prefix)) {
      found = e.fileId === fileId
      if (!found) continue
      if (await tryUpdateFileRefInMongo(e)) return
      break
    }
    if (!found) {
      STATS.fileHardDeleted++
      console.warn('bug: file hard-deleted while processing', projectId, fileId)
      return
    }

    STATS.fileTreeUpdated++
  }
  throw new OError(
    'file-tree updated repeatedly while trying to add hash',
    entry
  )
}

/**
 * @param {ProjectContext} ctx
 * @param {Folder} folder
 * @param {string} path
 * @param {boolean} isInputLoop
 * @return Generator<QueueEntry>
 */
function* findFiles(ctx, folder, path, isInputLoop = false) {
  if (!folder || typeof folder !== 'object') {
    ctx.fileTreeBroken = true
    logger.warn({ projectId: ctx.projectId, path }, 'bad file-tree, bad folder')
    return
  }
  if (!Array.isArray(folder.folders)) {
    folder.folders = []
    ctx.fileTreeBroken = true
    logger.warn(
      { projectId: ctx.projectId, path: `${path}.folders` },
      'bad file-tree, bad folders'
    )
  }
  let i = 0
  for (const child of folder.folders) {
    const idx = i++
    yield* findFiles(ctx, child, `${path}.folders.${idx}`, isInputLoop)
  }
  if (!Array.isArray(folder.fileRefs)) {
    folder.fileRefs = []
    ctx.fileTreeBroken = true
    logger.warn(
      { projectId: ctx.projectId, path: `${path}.fileRefs` },
      'bad file-tree, bad fileRefs'
    )
  }
  i = 0
  for (const fileRef of folder.fileRefs) {
    const idx = i++
    const fileRefPath = `${path}.fileRefs.${idx}`
    if (!fileRef._id || !(fileRef._id instanceof ObjectId)) {
      ctx.fileTreeBroken = true
      logger.warn(
        { projectId: ctx.projectId, path: fileRefPath },
        'bad file-tree, bad fileRef id'
      )
      continue
    }
    const fileId = fileRef._id.toString()
    if (PROCESS_HASHED_FILES && fileRef.hash) {
      if (ctx.canSkipProcessingHashedFile(fileRef.hash)) continue
      if (isInputLoop) {
        ctx.remainingQueueEntries++
        STATS.filesWithHash++
      }
      yield {
        ctx,
        cacheKey: fileRef.hash,
        fileId,
        path: MONGO_PATH_SKIP_WRITE_HASH_TO_FILE_TREE,
        hash: fileRef.hash,
      }
    }
    if (!fileRef.hash) {
      if (isInputLoop) {
        ctx.remainingQueueEntries++
        STATS.filesWithoutHash++
      }
      yield {
        ctx,
        cacheKey: fileId,
        fileId,
        path: fileRefPath,
      }
    }
  }
}

/**
 * @param {Array<Project>} projects
 * @param {string} prefix
 * @param {Map<string,Array<Blob>>} blobs
 * @return Generator<QueueEntry>
 */
function* findFileInBatch(projects, prefix, blobs) {
  for (const project of projects) {
    const projectIdS = project._id.toString()
    const historyIdS = project.overleaf.history.id.toString()
    const projectBlobs = blobs.get(historyIdS) || []
    const ctx = new ProjectContext(project._id, historyIdS, projectBlobs)
    try {
      yield* findFiles(ctx, project.rootFolder?.[0], prefix, true)
    } catch (err) {
      logger.error(
        { err, projectId: projectIdS },
        'bad file-tree, processing error'
      )
    } finally {
      if (ctx.fileTreeBroken) STATS.badFileTrees++
    }
  }
}

/**
 * @param {Array<Project>} batch
 * @return {Promise<{nBlobs: number, blobs: Map<string, Array<Blob>>}>}
 */
async function collectProjectBlobs(batch) {
  if (!PROCESS_BLOBS) return { nBlobs: 0, blobs: new Map() }
  return await getProjectBlobsBatch(batch.map(p => p.overleaf.history.id))
}

const BATCH_FILE_UPDATES = 100

const MONGO_PATH_SKIP_WRITE_HASH_TO_FILE_TREE = 'skip-write-to-file-tree'

class ProjectContext {
  /** @type {Map<string, Blob>} */
  #historyBlobs

  /** @type {number} */
  remainingQueueEntries = 0

  /** @type {boolean} */
  fileTreeBroken = false

  /**
   * @param {ObjectId} projectId
   * @param {string} historyId
   * @param {Array<Blob>} blobs
   */
  constructor(projectId, historyId, blobs) {
    this.projectId = projectId
    this.historyId = historyId
    this.#historyBlobs = new Map(blobs.map(b => [b.getHash(), b]))
  }

  /**
   * @param {string} hash
   * @return {Blob | undefined}
   */
  getCachedHistoryBlob(hash) {
    return this.#historyBlobs.get(hash)
  }

  /**
   * @param {Blob} blob
   */
  recordHistoryBlob(blob) {
    this.#historyBlobs.set(blob.getHash(), blob)
  }

  /**
   * @param {string} hash
   * @return {boolean}
   */
  canSkipProcessingHashedFile(hash) {
    if (this.#historyBlobs.has(hash)) return true // This file will be processed as blob.
    if (GLOBAL_BLOBS.has(hash)) return true // global blob
    return false
  }

  async flushMongoQueuesIfNeeded() {
    if (this.remainingQueueEntries === 0) {
      await this.flushMongoQueues()
    }

    if (this.#pendingFileWrites.length > BATCH_FILE_UPDATES) {
      await this.#storeFileHashes()
    }
  }

  async flushMongoQueues() {
    await this.#storeFileHashes()
  }

  /** @type {Set<string>} */
  #pendingBlobs = new Set()
  /** @type {Set<string>} */
  #completedBlobs = new Set()

  /**
   * @param {string} hash
   */
  recordPendingBlob(hash) {
    this.#pendingBlobs.add(hash)
  }

  /**
   * @param {string} hash
   */
  recordFailedBlob(hash) {
    this.#pendingBlobs.delete(hash)
  }

  /**
   * @param {string} hash
   */
  recordCompletedBlob(hash) {
    this.#completedBlobs.add(hash)
    this.#pendingBlobs.delete(hash)
  }

  /**
   * @param {string} hash
   * @return {boolean}
   */
  hasCompletedBlob(hash) {
    return this.#pendingBlobs.has(hash) || this.#completedBlobs.has(hash)
  }

  /** @type {Array<QueueEntry>} */
  #pendingFileWrites = []

  /**
   * @param {QueueEntry} entry
   */
  queueFileForWritingHash(entry) {
    if (entry.path === MONGO_PATH_SKIP_WRITE_HASH_TO_FILE_TREE) return
    this.#pendingFileWrites.push(entry)
  }

  /**
   * @param {Collection} collection
   * @param {Array<QueueEntry>} entries
   * @param {Object} query
   * @return {Promise<Array<QueueEntry>>}
   */
  async #tryBatchHashWrites(collection, entries, query) {
    if (entries.length === 0) return []
    const update = {}
    for (const entry of entries) {
      query[`${entry.path}._id`] = new ObjectId(entry.fileId)
      update[`${entry.path}.hash`] = entry.hash
    }
    STATS.mongoUpdates++
    const result = await collection.updateOne(query, { $set: update })
    if (result.matchedCount === 1) {
      return [] // all updated
    }
    return entries
  }

  async #storeFileHashes() {
    if (this.#pendingFileWrites.length === 0) return
    const individualUpdates = []
    const projectEntries = []
    const deletedProjectEntries = []
    for (const entry of this.#pendingFileWrites) {
      if (entry.path.startsWith('project.')) {
        deletedProjectEntries.push(entry)
      } else {
        projectEntries.push(entry)
      }
    }
    this.#pendingFileWrites.length = 0

    // Try to process them together, otherwise fallback to individual updates and retries.
    individualUpdates.push(
      ...(await this.#tryBatchHashWrites(projectsCollection, projectEntries, {
        _id: this.projectId,
      }))
    )
    individualUpdates.push(
      ...(await this.#tryBatchHashWrites(
        deletedProjectsCollection,
        deletedProjectEntries,
        { 'deleterData.deletedProjectId': this.projectId }
      ))
    )
    for (const entry of individualUpdates) {
      await updateFileRefInMongo(entry)
    }
  }

  /** @type {Map<string, Promise<string>>} */
  #pendingFiles = new Map()

  /**
   * @param {QueueEntry} entry
   */
  async processFile(entry) {
    if (this.#pendingFiles.has(entry.cacheKey)) {
      STATS.filesDuplicated++
    } else {
      this.#pendingFiles.set(entry.cacheKey, processFileWithCleanup(entry))
    }
    try {
      entry.hash = await this.#pendingFiles.get(entry.cacheKey)
    } finally {
      this.remainingQueueEntries--
    }
    this.queueFileForWritingHash(entry)
    await this.flushMongoQueuesIfNeeded()
  }
}

/**
 * @param {Blob} blob
 * @return {number}
 */
function estimateBlobSize(blob) {
  let size = blob.getByteLength()
  if (blob.getStringLength()) {
    // approximation for gzip (25 bytes gzip overhead and 20% compression ratio)
    size = 25 + Math.ceil(size * 0.2)
  }
  return size
}

async function processProjectsFromFile() {
  const rl = readline.createInterface({
    input: fs.createReadStream(PROJECT_IDS_FROM),
  })
  for await (const projectId of rl) {
    if (!projectId) continue // skip over trailing new line
    let project = await typedProjectsCollection.findOne(
      { _id: new ObjectId(projectId) },
      { projection: { rootFolder: 1, _id: 1, 'overleaf.history.id': 1 } }
    )
    let prefix = 'rootFolder.0'
    if (!project) {
      const deletedProject = await typedDeletedProjectsCollection.findOne(
        { 'deleterData.deletedProjectId': new ObjectId(projectId) },
        {
          projection: {
            'project.rootFolder': 1,
            'project._id': 1,
            'project.overleaf.history.id': 1,
          },
        }
      )
      if (!deletedProject?.project) {
        logger.warn({ projectId }, 'project hard-deleted')
        continue
      }
      project = deletedProject.project
      prefix = 'project.rootFolder.0'
    }
    if (!project?.overleaf?.history?.id) {
      logger.warn({ projectId }, 'project has no history id')
      continue
    }
    try {
      await queueNextBatch([project], prefix)
    } catch (err) {
      gracefulShutdownInitiated = true
      await waitForDeferredQueues()
      throw err
    }
  }
  await waitForDeferredQueues()
  console.warn('Done updating projects from input file')
}

async function processNonDeletedProjects() {
  try {
    await batchedUpdate(
      projectsCollection,
      { 'overleaf.history.id': { $exists: true } },
      queueNextBatch,
      { rootFolder: 1, _id: 1, 'overleaf.history.id': 1 },
      {},
      {
        BATCH_RANGE_START,
        BATCH_RANGE_END,
      }
    )
  } catch (err) {
    gracefulShutdownInitiated = true
    throw err
  } finally {
    await waitForDeferredQueues()
  }
  console.warn('Done updating live projects')
}

async function processDeletedProjects() {
  try {
    await batchedUpdate(
      deletedProjectsCollection,
      {
        'deleterData.deletedProjectId': {
          $gt: new ObjectId(BATCH_RANGE_START),
          $lte: new ObjectId(BATCH_RANGE_END),
        },
        'project.overleaf.history.id': { $exists: true },
      },
      handleDeletedFileTreeBatch,
      {
        'project.rootFolder': 1,
        'project._id': 1,
        'project.overleaf.history.id': 1,
      }
    )
  } catch (err) {
    gracefulShutdownInitiated = true
    throw err
  } finally {
    await waitForDeferredQueues()
  }
  console.warn('Done updating deleted projects')
}

async function main() {
  console.log('Starting project file backup...')
  await loadGlobalBlobs()
  console.log('Loaded global blobs:', GLOBAL_BLOBS.size)
  if (PROJECT_IDS_FROM) {
    console.log(
      `Processing projects from file: ${PROJECT_IDS_FROM}, this may take a while...`
    )
    await processProjectsFromFile()
  } else {
    if (PROCESS_NON_DELETED_PROJECTS) {
      console.log('Processing non-deleted projects...')
      await processNonDeletedProjects()
    }
    if (PROCESS_DELETED_PROJECTS) {
      console.log('Processing deleted projects...')
      await processDeletedProjects()
    }
  }
  console.warn('Done.')
}

try {
  try {
    await main()
  } finally {
    printStats(true)
    try {
      // Perform non-recursive removal of the BUFFER_DIR. Individual files
      // should get removed in parallel as part of batch processing.
      await fs.promises.rmdir(BUFFER_DIR)
    } catch (err) {
      console.error(`cleanup of BUFFER_DIR=${BUFFER_DIR} failed`, err)
    }
  }

  let code = 0
  if (STATS.filesFailed > 0) {
    console.warn('Some files could not be processed, see logs and try again')
    code++
  }
  if (STATS.fileHardDeleted > 0) {
    console.warn(
      'Some hashes could not be updated as the files were hard-deleted, this should not happen'
    )
    code++
  }
  if (STATS.projectHardDeleted > 0) {
    console.warn(
      'Some hashes could not be updated as the project was hard-deleted, this should not happen'
    )
    code++
  }
  await setTimeout(SLEEP_BEFORE_EXIT)
  process.exit(code)
} catch (err) {
  console.error(err)
  await setTimeout(SLEEP_BEFORE_EXIT)
  process.exit(1)
}
