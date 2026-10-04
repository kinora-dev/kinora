// A flat piece of UI floating in the stage's 3D space, looked at by a camera.
// The camera is described the way a motion designer thinks about it: which
// point of the plane (fx, fy) sits at which point of the screen (sx, sy), how
// zoomed in, and how tilted.

export const STAGE_W = 1920
export const STAGE_H = 1080
export const PERSPECTIVE = 2400

const RAD = Math.PI / 180

export class Plane {
  constructor(el) {
    this.el = el
    this.cam = { fx: 0, fy: 0, sx: 0, sy: 0, zoom: 1, rx: 0, ry: 0, rz: 0 }
  }

  look(cam) {
    this.cam = cam
    this.el.style.transform
      = `translate3d(${cam.sx}px,${cam.sy}px,0) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) rotateZ(${cam.rz}deg) scale(${cam.zoom}) translate(${-cam.fx}px,${-cam.fy}px)`
  }

  /**
   * Where a plane point lands on screen, and how big one plane pixel is there.
   * Pass a camera to ask about another moment without moving the plane.
   */
  project(x, y, c = this.cam) {
    let px = (x - c.fx) * c.zoom
    let py = (y - c.fy) * c.zoom
    let pz = 0
    // Same order the browser applies the transform list: Z, then Y, then X.
    const cz = Math.cos(c.rz * RAD)
    const sz = Math.sin(c.rz * RAD)
    ;[px, py] = [px * cz - py * sz, px * sz + py * cz]
    const cy = Math.cos(c.ry * RAD)
    const sy = Math.sin(c.ry * RAD)
    ;[px, pz] = [px * cy + pz * sy, -px * sy + pz * cy]
    const cx = Math.cos(c.rx * RAD)
    const sx = Math.sin(c.rx * RAD)
    ;[py, pz] = [py * cx - pz * sx, py * sx + pz * cx]
    const k = PERSPECTIVE / (PERSPECTIVE - pz)
    return {
      x: STAGE_W / 2 + (px + c.sx - STAGE_W / 2) * k,
      y: STAGE_H / 2 + (py + c.sy - STAGE_H / 2) * k,
      scale: c.zoom * k,
    }
  }

  /** Screen-space bounding box of a plane rect. */
  projectRect({ x, y, w, h }, cam = this.cam) {
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => this.project(px, py, cam))
    const xs = pts.map(p => p.x)
    const ys = pts.map(p => p.y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top }
  }
}
