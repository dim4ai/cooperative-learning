// Cropping a picture: a frame over it is moved/resized by the teacher, then the picture
// keeps only what is inside (Fabric's cropX/cropY/width/height — the file is untouched,
// "Вернуть целиком" brings the rest back). Works for rotated and flipped pictures too.
import { FabricImage, Point, Rect, util } from 'fabric'

function natural(img: FabricImage): { w: number; h: number } {
  const el = img.getElement() as HTMLImageElement
  return { w: el.naturalWidth || img.width, h: el.naturalHeight || img.height }
}

/** Frame exactly over the visible part of the picture */
export function cropFrame(img: FabricImage): Rect {
  const c = img.getCenterPoint()
  return new Rect({
    left: c.x, top: c.y, originX: 'center', originY: 'center', angle: img.angle,
    width: img.width * Math.abs(img.scaleX), height: img.height * Math.abs(img.scaleY),
    fill: 'rgba(245,158,11,0.08)', stroke: '#f59e0b', strokeWidth: 2, strokeDashArray: [8, 6], strokeUniform: true,
    lockRotation: true, hasRotatingPoint: false, excludeFromExport: true, objectCaching: false,
  })
}

/** Keep the part of the picture under the frame (clamped to the picture's own pixels) */
export function applyCrop(img: FabricImage, frame: Rect) {
  const toLocal = util.invertTransform(img.calcTransformMatrix())
  const pts = frame.getCoords().map(p => util.transformPoint(p, toLocal))
  const { w: nw, h: nh } = natural(img)
  // local (0,0) = center of the visible part; source pixel = local + size/2 + crop
  const sx = (x: number) => x + img.width / 2 + img.cropX
  const sy = (y: number) => y + img.height / 2 + img.cropY
  const x0 = Math.max(0, Math.min(...pts.map(p => sx(p.x))))
  const x1 = Math.min(nw, Math.max(...pts.map(p => sx(p.x))))
  const y0 = Math.max(0, Math.min(...pts.map(p => sy(p.y))))
  const y1 = Math.min(nh, Math.max(...pts.map(p => sy(p.y))))
  if (x1 - x0 < 2 || y1 - y0 < 2) return
  setRegion(img, x0, y0, x1 - x0, y1 - y0)
}

export function isCropped(img: FabricImage): boolean {
  const { w, h } = natural(img)
  return img.cropX > 0 || img.cropY > 0 || Math.round(img.width) < w || Math.round(img.height) < h
}

/** The whole picture again, keeping the shown part where it was */
export function uncrop(img: FabricImage) {
  const { w, h } = natural(img)
  setRegion(img, 0, 0, w, h)
}

/** Show source region (x, y, w, h); the picture moves so that the same pixels stay in place */
function setRegion(img: FabricImage, x: number, y: number, w: number, h: number) {
  const m = img.calcTransformMatrix()
  const local = new Point(x + w / 2 - img.cropX - img.width / 2, y + h / 2 - img.cropY - img.height / 2)
  const center = util.transformPoint(local, m)
  img.set({ cropX: x, cropY: y, width: w, height: h })
  img.setPositionByOrigin(center, 'center', 'center')
  img.setCoords()
}
