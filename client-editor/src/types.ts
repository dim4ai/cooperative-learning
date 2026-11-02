export type BlockType = 'group' | 'individual' | 'pairs' | 'fours'
export type AttachmentKind = 'image' | 'pdf' | 'video'

export interface Attachment {
  name: string       // file name inside the lesson archive, under media/
  kind: AttachmentKind
}

import type { Scene } from './slides/model'
import { normalizeLayers, sceneMediaNames } from './slides/model'
export type { Scene, SceneObject } from './slides/model'
export { SLIDE_WIDTH, SLIDE_HEIGHT } from './slides/model'

export interface BlockBase {
  id: string
  type: BlockType
  duration: number // minutes
  title: string
  teacherNote: string
  attachments: Attachment[]
  slides?: Scene[]
}

/** Every media name the lesson references (attachments + slide images) */
export function usedMediaNames(blocks: LessonBlock[]): Set<string> {
  const names = new Set<string>()
  for (const b of blocks) {
    for (const a of b.attachments) names.add(a.name)
    for (const s of b.slides ?? []) for (const n of sceneMediaNames(s.objects)) names.add(n)
  }
  return names
}

/** Bring blocks from older files/drafts to the current shape (in place) */
export function normalizeBlocks(blocks: LessonBlock[]): LessonBlock[] {
  for (const b of blocks as (LessonBlock & { scene?: Scene })[]) {
    b.attachments ??= []
    if (b.scene) { b.slides = [...(b.slides ?? []), b.scene]; delete b.scene } // single-slide prototype
    b.slides = (b.slides ?? []).map(s => {
      s.id ??= Math.random().toString(36).slice(2, 12)
      s.objects ??= []
      return normalizeLayers(s)
    })
  }
  return blocks
}

export interface GroupBlock extends BlockBase {
  type: 'group'
}

export interface IndividualBlock extends BlockBase {
  type: 'individual'
  task: string
}

export interface PairsBlock extends BlockBase {
  type: 'pairs'
  task: string
  technique: string
}

export interface FoursBlock extends BlockBase {
  type: 'fours'
  task: string
  technique: string
}

export type LessonBlock = GroupBlock | IndividualBlock | PairsBlock | FoursBlock

export interface LessonMeta {
  title: string
  subject: string
  grade: string
  author: string
  createdAt: string
}

export interface LessonFile {
  version: 1
  meta: LessonMeta
  blocks: LessonBlock[]
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  group: 'Объяснение',
  individual: 'Индивидуальная работа',
  pairs: 'Парная работа',
  fours: 'Работа в четвёрках',
}

export const TECHNIQUES = [
  { value: '', label: '— не указано —' },
  { value: 'think-pair-share', label: 'Think-Pair-Share' },
  { value: 'rally-robin', label: 'Rally Robin' },
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'jot-thoughts', label: 'Jot Thoughts' },
  { value: 'timed-pair-share', label: 'Timed Pair Share' },
  { value: 'sage-and-scribe', label: 'Sage and Scribe' },
]

export function kindFromName(name: string): AttachmentKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  return 'pdf'
}
