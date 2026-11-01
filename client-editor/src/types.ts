export type BlockType = 'group' | 'individual' | 'pairs' | 'fours'
export type AttachmentKind = 'image' | 'pdf' | 'video'

export interface Attachment {
  name: string       // file name inside the lesson archive, under media/
  kind: AttachmentKind
}

export interface BlockBase {
  id: string
  type: BlockType
  duration: number // minutes
  title: string
  teacherNote: string
  attachments: Attachment[]
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
