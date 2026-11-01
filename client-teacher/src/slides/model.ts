// GENERATED COPY of client-editor/src/slides/model.ts — do not edit here, edit the original and run scripts/sync-slides.sh
// Slide data model — shared verbatim by client-editor, client-teacher and client-student.
// Canonical copy lives in client-editor/src/slides; run scripts/sync-slides.sh after changing it.

/**
 * Slide of a block: a scene of layered objects (Fabric.js object model).
 * Array order = z-order (later = on top). Images reference media by name
 * (`mediaName`, file in media/), never inline data.
 */
export interface Scene {
  id: string
  engine: 'fabric'
  width: number
  height: number
  background: string
  objects: SceneObject[]
}

/** Fabric object JSON plus our own fields */
export interface SceneObject {
  type: string
  uid: string
  mediaName?: string
  pinned?: boolean           // locked in place (background), not selectable in editor
  studentHidden?: boolean    // hidden from students until revealed
  studentDraggable?: boolean // student can move it during the lesson
  [key: string]: unknown
}

export const SLIDE_WIDTH = 1600
export const SLIDE_HEIGHT = 900
