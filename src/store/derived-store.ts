import path from 'node:path'
import { z } from 'zod'
import { type FileEntry, FileEntrySchema } from '../contract/review-artifact.js'
import { collectDiffs, toFileEntry, toPatchMap } from '../git/diff-collector.js'
import type { Git } from '../git/git.js'
import { materialize } from '../git/materialize.js'
import { labelPatch } from '../git/patch-lines.js'
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from './atomic-json.js'
import type { CanvasStore } from './canvas-store.js'

export interface Derived {
  files: FileEntry[]
  patches: Record<string, string>
}

/**
 * One diff: a commit against the merge base it is diffed from. A pull request moved to another base
 * diffs the same commit from another merge base, so a commit alone does not name a diff.
 */
export interface DiffedCommit {
  headSha: string
  mergeBaseSha: string
}

const DerivedMetaSchema = z.object({ headSha: z.string(), mergeBaseSha: z.string(), builtAt: z.string() })
const FilesSchema = z.array(FileEntrySchema)
const PatchesSchema = z.record(z.string(), z.string())

/**
 * The diffs of each diff the page, the chat, or a generation reads, under
 * `canvases/<head>/derived/<merge base>/`. The directory is named by the whole diff, so two merge
 * bases of one commit never share one, and a generation for a new base never reads files a page
 * still showing the old base just rebuilt.
 */
export interface DerivedStore {
  derivedDir(diff: DiffedCommit): string
  /** Both commits are local, so `ensure` can rebuild. */
  derivable(diff: DiffedCommit): Promise<boolean>
  /** Reads the diff's directory when it is complete, otherwise builds it from local git. */
  ensure(diff: DiffedCommit): Promise<Derived>
  read(diff: DiffedCommit): Promise<Derived | null>
  /** The diffs built from the clone when both commits are local; else the copy built earlier. */
  readOrBuild(diff: DiffedCommit): Promise<Derived | null>
  /** Lines `from..to` (1-based, inclusive) of a materialized file, or null when not materialized. */
  readLines(
    diff: DiffedCommit,
    side: 'head' | 'base',
    filePath: string,
    from: number,
    to: number
  ): Promise<string[] | null>
}

export function createDerivedStore(canvases: CanvasStore, git: Git, now: () => Date): DerivedStore {
  const derivedDir = (diff: DiffedCommit): string => {
    if (!/^[0-9a-f]{40}$/.test(diff.mergeBaseSha)) {
      throw new Error(`not a commit sha: ${diff.mergeBaseSha}`)
    }
    return path.join(canvases.canvasDir(diff.headSha), 'derived', diff.mergeBaseSha)
  }

  const read = async (diff: DiffedCommit): Promise<Derived | null> => {
    const dir = derivedDir(diff)
    const files = await readJson(path.join(dir, 'files.json'), FilesSchema)
    const patches = await readJson(path.join(dir, 'patches.json'), PatchesSchema)
    if (files === null || patches === null) {
      return null
    }
    return { files, patches }
  }

  const derivable = async (diff: DiffedCommit): Promise<boolean> =>
    (await git.commitExists(diff.headSha)) && (await git.commitExists(diff.mergeBaseSha))

  const ensure = async (diff: DiffedCommit): Promise<Derived> => {
    const { headSha, mergeBaseSha } = diff
    const dir = derivedDir(diff)
    // meta.json is written last, so a directory a build left half-written is built again.
    if ((await readJson(path.join(dir, 'meta.json'), DerivedMetaSchema)) !== null) {
      const cached = await read(diff)
      if (cached !== null) {
        return cached
      }
    }
    const collected = await collectDiffs(git, mergeBaseSha, headSha)
    const files = collected.map(toFileEntry)
    const patches = toPatchMap(collected)
    await writeJsonAtomic(path.join(dir, 'files.json'), files)
    await writeJsonAtomic(path.join(dir, 'patches.json'), patches)
    for (const f of collected) {
      await writeTextAtomic(path.join(dir, 'patches', `${f.key}.diff`), `${labelPatch(f.key, f.patch)}\n`)
    }
    await materialize(git, { headSha, mergeBaseSha, files: collected, outDir: dir })
    await writeJsonAtomic(path.join(dir, 'meta.json'), {
      headSha,
      mergeBaseSha,
      builtAt: now().toISOString(),
    })
    return { files, patches }
  }

  return {
    derivedDir,
    derivable,
    ensure,
    read,
    readOrBuild: async diff => ((await derivable(diff)) ? ensure(diff) : read(diff)),
    readLines: async (diff, side, filePath, from, to) => {
      const root = path.join(derivedDir(diff), side)
      const full = path.resolve(root, filePath)
      if (!full.startsWith(root + path.sep)) {
        return null
      }
      const text = await readText(full)
      if (text === null) {
        return null
      }
      const lines = text.split('\n')
      if (lines[lines.length - 1] === '') {
        lines.pop()
      }
      return lines.slice(Math.max(from, 1) - 1, Math.max(to, 0))
    },
  }
}
