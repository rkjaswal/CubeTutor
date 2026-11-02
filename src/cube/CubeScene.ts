import type { ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';

import { createGlRenderer } from './createRenderer';
import {
  applyMove,
  createSolvedCube,
  FACE_COLOR,
  invertMove,
  isSolved,
  moveToken,
  parseMove,
  scrambleMoves,
  type Axis,
  type Cubie,
  type Face,
  type Move,
  type Sign,
  type Vec3,
} from './model';

export type CubeStatus = {
  solveMoves: number;
  solved: boolean;
  busy: boolean;
  lastMove: string | null;
  scrambling: boolean;
};

const SPACING = 1.05;
const CUBIE = 0.94;
const STICKER = 0.76;
const STICKER_LIFT = CUBIE / 2 + 0.012;
const QUARTER = Math.PI / 2;

type Queued = { move: Move; record: boolean; duration: number };

type Drag =
  | { type: 'orbit' }
  | {
      type: 'pending';
      x: number;
      y: number;
      homeKey: string;
      normal: THREE.Vector3;
      point: THREE.Vector3;
    }
  | {
      type: 'turn';
      axis: Axis;
      layer: -1 | 0 | 1;
      startX: number;
      startY: number;
      tangentX: number;
      tangentY: number;
      angle: number;
      lastAngle: number;
      lastT: number;
      velocity: number;
    };

function homeKey(home: Vec3): string {
  return home.join(',');
}

function dominantAxis(v: THREE.Vector3): Axis {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return 0;
  if (ay >= az) return 1;
  return 2;
}

function asLayer(value: number): -1 | 0 | 1 {
  const rounded = Math.round(value);
  if (rounded <= -1) return -1;
  if (rounded >= 1) return 1;
  return 0;
}

function stickerGeometry(): THREE.ShapeGeometry {
  const size = STICKER;
  const radius = 0.09;
  const half = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.quadraticCurveTo(half, -half, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.quadraticCurveTo(half, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.quadraticCurveTo(-half, half, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.quadraticCurveTo(-half, -half, -half + radius, -half);
  return new THREE.ShapeGeometry(shape, 2);
}

function stickersFor(home: Vec3): { normal: Vec3; color: string }[] {
  const stickers: { normal: Vec3; color: string }[] = [];
  if (home[0] === 1) stickers.push({ normal: [1, 0, 0], color: FACE_COLOR.R });
  if (home[0] === -1) stickers.push({ normal: [-1, 0, 0], color: FACE_COLOR.L });
  if (home[1] === 1) stickers.push({ normal: [0, 1, 0], color: FACE_COLOR.U });
  if (home[1] === -1) stickers.push({ normal: [0, -1, 0], color: FACE_COLOR.D });
  if (home[2] === 1) stickers.push({ normal: [0, 0, 1], color: FACE_COLOR.F });
  if (home[2] === -1) stickers.push({ normal: [0, 0, -1], color: FACE_COLOR.B });
  return stickers;
}

function orientSticker(mesh: THREE.Mesh, normal: Vec3) {
  if (normal[0] === 1) mesh.rotation.y = Math.PI / 2;
  else if (normal[0] === -1) mesh.rotation.y = -Math.PI / 2;
  else if (normal[1] === 1) mesh.rotation.x = -Math.PI / 2;
  else if (normal[1] === -1) mesh.rotation.x = Math.PI / 2;
  else if (normal[2] === -1) mesh.rotation.y = Math.PI;
  mesh.position.set(normal[0] * STICKER_LIFT, normal[1] * STICKER_LIFT, normal[2] * STICKER_LIFT);
}

export class CubeScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly cubeGroup = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly axisVector = new THREE.Vector3();
  private readonly bodyGeometry = new THREE.BoxGeometry(CUBIE, CUBIE, CUBIE);
  private readonly stickerGeo = stickerGeometry();
  private readonly materials: THREE.Material[] = [];
  private readonly shadowGeometry = new THREE.CircleGeometry(1.85, 48);
  private readonly ringGeometry = new THREE.RingGeometry(1.62, 1.78, 64);

  private model: Cubie[] = createSolvedCube();
  private queue: Queued[] = [];
  private history: Move[] = [];
  private drag: Drag | null = null;
  private lastMove: string | null = null;
  private scrambling = false;
  private animating = false;
  private disposed = false;
  private tweenId = 0;
  private raf = 0;
  private viewWidth = 1;
  private viewHeight = 1;
  private bufferWidth = 0;
  private bufferHeight = 0;
  private lastX = 0;
  private lastY = 0;
  private theta = 0.62;
  private phi = 1.02;

  constructor(
    private readonly gl: ExpoWebGLRenderingContext,
    private readonly onStatus: (status: CubeStatus) => void,
  ) {
    this.renderer = createGlRenderer(gl);
    this.bufferWidth = gl.drawingBufferWidth;
    this.bufferHeight = gl.drawingBufferHeight;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.scene.add(this.cubeGroup);
    this.scene.add(this.pivot);
    this.addLights();
    this.addStage();
    this.buildCubies();
    this.syncAll();
    this.updateCamera();
    this.emit();
    this.frame();
  }

  setViewSize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.viewWidth = width;
    this.viewHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
  }

  pointerDown(x: number, y: number) {
    this.lastX = x;
    this.lastY = y;
    if (this.animating || this.queue.length > 0) {
      this.drag = { type: 'orbit' };
      return;
    }
    const hit = this.pick(x, y);
    if (!hit) {
      this.drag = { type: 'orbit' };
      return;
    }
    this.drag = {
      type: 'pending',
      x,
      y,
      homeKey: hit.homeKey,
      normal: hit.normal,
      point: hit.point,
    };
  }

  beginOrbit(x: number, y: number) {
    this.lastX = x;
    this.lastY = y;
    if (this.drag?.type === 'turn') return;
    this.drag = { type: 'orbit' };
  }

  pointerMove(x: number, y: number) {
    const drag = this.drag;
    if (!drag) return;

    if (drag.type === 'orbit') {
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      this.theta -= dx * 0.008;
      this.phi = Math.min(Math.PI - 0.2, Math.max(0.2, this.phi + dy * 0.008));
      this.updateCamera();
    } else if (drag.type === 'pending') {
      if (Math.hypot(x - drag.x, y - drag.y) >= 12) {
        const locked = this.lockTurn(drag, x, y);
        if (!locked) {
          this.drag = { type: 'orbit' };
        } else {
          this.drag = locked;
          this.attachLayer(locked.axis, locked.layer);
          this.updateTurn(locked, x, y);
        }
      }
    } else {
      this.updateTurn(drag, x, y);
    }

    this.lastX = x;
    this.lastY = y;
  }

  pointerUp() {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.type !== 'turn') return;

    let target = 0;
    if (drag.angle > 0.32 || (drag.angle > 0.1 && drag.velocity > 0.004)) target = QUARTER;
    else if (drag.angle < -0.32 || (drag.angle < -0.1 && drag.velocity < -0.004)) target = -QUARTER;

    const { axis, layer } = drag;
    this.animating = true;
    this.emit();
    this.tween(drag.angle, target, 150, (angle) => {
      this.axisVector.set(0, 0, 0).setComponent(axis, 1);
      this.pivot.quaternion.setFromAxisAngle(this.axisVector, angle);
    }, () => {
      if (target === 0) {
        this.releasePivot();
        this.syncAll();
      } else {
        const dir: Sign = target > 0 ? 1 : -1;
        this.finishMove({ axis, layer, dir, turns: 1 }, true);
      }
      this.animating = false;
      this.emit();
      this.pump();
    });
  }

  scramble() {
    if (this.buttonLocked()) return;
    this.drag = null;
    this.tweenId += 1;
    this.animating = false;
    this.releasePivot();
    this.syncAll();
    this.queue = [];
    this.history = [];
    this.lastMove = null;
    this.scrambling = true;
    for (const move of scrambleMoves(25)) {
      this.queue.push({ move, record: false, duration: 80 });
    }
    this.emit();
    this.pump();
  }

  undo() {
    if (this.buttonLocked()) return;
    this.drag = null;
    const move = this.history.pop();
    if (!move) return;
    this.enqueue(invertMove(move), false, 160);
  }

  reset() {
    this.tweenId += 1;
    this.queue = [];
    this.history = [];
    this.animating = false;
    this.scrambling = false;
    this.drag = null;
    this.lastMove = null;
    this.releasePivot();
    this.model = createSolvedCube();
    this.syncAll();
    this.emit();
  }

  play(token: string) {
    if (this.buttonLocked()) return;
    this.drag = null;
    this.enqueue(parseMove(token), true, 180);
  }

  dispose() {
    this.disposed = true;
    this.tweenId += 1;
    cancelAnimationFrame(this.raf);
    this.bodyGeometry.dispose();
    this.stickerGeo.dispose();
    this.shadowGeometry.dispose();
    this.ringGeometry.dispose();
    for (const material of this.materials) material.dispose();
    this.renderer.dispose();
  }

  private enqueue(move: Move, record: boolean, duration: number) {
    this.queue.push({ move, record, duration });
    this.pump();
  }

  private buttonLocked() {
    return this.animating || this.queue.length > 0 || this.drag?.type === 'turn';
  }

  private interactionLocked() {
    return this.buttonLocked() || this.drag?.type === 'pending';
  }

  private pump() {
    if (this.animating || this.disposed) return;
    if (this.drag?.type === 'turn' || this.drag?.type === 'pending') return;
    const next = this.queue.shift();
    if (!next) {
      if (this.scrambling) {
        this.scrambling = false;
        this.emit();
      }
      return;
    }
    this.animateMove(next);
  }

  private animateMove(item: Queued) {
    this.animating = true;
    this.emit();
    this.attachLayer(item.move.axis, item.move.layer);
    const target = item.move.dir * item.move.turns * QUARTER;
    this.tween(0, target, item.duration, (angle) => {
      this.axisVector.set(0, 0, 0).setComponent(item.move.axis, 1);
      this.pivot.quaternion.setFromAxisAngle(this.axisVector, angle);
    }, () => {
      this.finishMove(item.move, item.record);
      this.animating = false;
      this.emit();
      this.pump();
    });
  }

  private tween(from: number, to: number, ms: number, onFrame: (value: number) => void, onDone: () => void) {
    const id = ++this.tweenId;
    const start = Date.now();
    const step = () => {
      if (this.disposed || id !== this.tweenId) return;
      const t = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      onFrame(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
      else onDone();
    };
    step();
  }

  private finishMove(move: Move, record: boolean) {
    applyMove(this.model, move);
    this.releasePivot();
    this.syncAll();
    if (!record) return;
    this.history.push(move);
    this.lastMove = moveToken(move) ?? 'Slice';
  }

  private attachLayer(axis: Axis, layer: -1 | 0 | 1) {
    this.pivot.quaternion.identity();
    this.scene.updateMatrixWorld(true);
    for (const cubie of this.model) {
      if (cubie.pos[axis] !== layer) continue;
      const mesh = this.meshes.get(homeKey(cubie.home));
      if (mesh) this.pivot.attach(mesh);
    }
  }

  private releasePivot() {
    for (const child of [...this.pivot.children]) this.cubeGroup.attach(child);
    this.pivot.quaternion.identity();
    this.pivot.updateMatrixWorld(true);
  }

  private syncAll() {
    for (const cubie of this.model) {
      const mesh = this.meshes.get(homeKey(cubie.home));
      if (!mesh) continue;
      mesh.position.set(cubie.pos[0] * SPACING, cubie.pos[1] * SPACING, cubie.pos[2] * SPACING);
      mesh.quaternion.set(cubie.quat[0], cubie.quat[1], cubie.quat[2], cubie.quat[3]);
    }
  }

  private lockTurn(pending: Extract<Drag, { type: 'pending' }>, x: number, y: number): Extract<Drag, { type: 'turn' }> | null {
    const world = this.dragWorld(x - pending.x, y - pending.y);
    const planar = world.clone().addScaledVector(pending.normal, -world.dot(pending.normal));
    if (planar.lengthSq() < 1e-8) return null;
    planar.normalize();
    const raw = new THREE.Vector3().crossVectors(pending.normal, planar);
    const axis = dominantAxis(raw);
    const cubie = this.model.find((item) => homeKey(item.home) === pending.homeKey);
    if (!cubie) return null;

    const positive = new THREE.Vector3().setComponent(axis, 1);
    const tangent = new THREE.Vector3().crossVectors(positive, pending.point).normalize();
    const origin = this.project(pending.point);
    const tip = this.project(pending.point.clone().addScaledVector(tangent, 0.8));
    const sx = tip.x - origin.x;
    const sy = tip.y - origin.y;
    const length = Math.hypot(sx, sy);
    if (length < 6) return null;

    const now = Date.now();
    return {
      type: 'turn',
      axis,
      layer: asLayer(cubie.pos[axis]),
      startX: pending.x,
      startY: pending.y,
      tangentX: sx / length,
      tangentY: sy / length,
      angle: 0,
      lastAngle: 0,
      lastT: now,
      velocity: 0,
    };
  }

  private updateTurn(drag: Extract<Drag, { type: 'turn' }>, x: number, y: number) {
    const pixels = (x - drag.startX) * drag.tangentX + (y - drag.startY) * drag.tangentY;
    const angle = THREE.MathUtils.clamp((pixels / 118) * QUARTER, -QUARTER * 1.08, QUARTER * 1.08);
    const now = Date.now();
    const dt = now - drag.lastT;
    if (dt > 0) drag.velocity = (angle - drag.lastAngle) / dt;
    drag.lastAngle = angle;
    drag.lastT = now;
    drag.angle = angle;
    this.axisVector.set(0, 0, 0).setComponent(drag.axis, 1);
    this.pivot.quaternion.setFromAxisAngle(this.axisVector, angle);
  }

  private pick(x: number, y: number) {
    if (this.viewWidth <= 0 || this.viewHeight <= 0) return null;
    this.scene.updateMatrixWorld(true);
    this.ndc.set((x / this.viewWidth) * 2 - 1, -(y / this.viewHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.cubeGroup, true);
    for (const hit of hits) {
      if (!hit.face) continue;
      let object: THREE.Object3D | null = hit.object;
      let key: string | undefined;
      while (object) {
        if (typeof object.userData.homeKey === 'string') {
          key = object.userData.homeKey;
          break;
        }
        object = object.parent;
      }
      if (!key) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      const axis = dominantAxis(normal);
      const snapped = new THREE.Vector3().setComponent(axis, Math.sign(normal.getComponent(axis)) || 1);
      return { homeKey: key, normal: snapped, point: hit.point.clone() };
    }
    return null;
  }

  private dragWorld(dx: number, dy: number) {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    return right.multiplyScalar(dx).addScaledVector(up, -dy);
  }

  private project(point: THREE.Vector3) {
    const projected = point.clone().project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.viewWidth,
      y: (-projected.y * 0.5 + 0.5) * this.viewHeight,
    };
  }

  private updateCamera() {
    const aspect = this.viewWidth / Math.max(this.viewHeight, 1);
    const half = Math.tan((this.camera.fov * Math.PI) / 180 / 2);
    const limit = Math.min(half, half * aspect);
    // Cube corners are about 2.8 from the origin. Stay far enough that the
    // whole cube, including the ground shadow, remains inside the view.
    const distance = 3.6 / Math.max(limit, 0.05);
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      distance * sinPhi * Math.sin(this.theta),
      distance * Math.cos(this.phi),
      distance * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(0, 0, 0);
  }

  private addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    this.scene.add(new THREE.HemisphereLight(0xe7eeff, 0x24180f, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9eb6ff, 1.15);
    fill.position.set(-6, 2, -4);
    this.scene.add(fill);
  }

  private addStage() {
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.materials.push(shadowMaterial, ringMaterial);
    const shadow = new THREE.Mesh(this.shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.78;
    const ring = new THREE.Mesh(this.ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.77;
    this.scene.add(shadow, ring);
  }

  private buildCubies() {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x141414,
      roughness: 0.62,
      metalness: 0.18,
    });
    this.materials.push(bodyMaterial);
    const stickerMaterials = new Map<string, THREE.MeshStandardMaterial>();

    for (const cubie of this.model) {
      const group = new THREE.Group();
      group.userData.homeKey = homeKey(cubie.home);
      const body = new THREE.Mesh(this.bodyGeometry, bodyMaterial);
      group.add(body);

      for (const sticker of stickersFor(cubie.home)) {
        let material = stickerMaterials.get(sticker.color);
        if (!material) {
          material = new THREE.MeshStandardMaterial({
            color: sticker.color,
            roughness: 0.38,
            metalness: 0.04,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4,
          });
          stickerMaterials.set(sticker.color, material);
          this.materials.push(material);
        }
        const mesh = new THREE.Mesh(this.stickerGeo, material);
        orientSticker(mesh, sticker.normal);
        group.add(mesh);
      }

      this.meshes.set(homeKey(cubie.home), group);
      this.cubeGroup.add(group);
    }
  }

  private emit() {
    this.onStatus({
      solveMoves: this.history.length,
      solved: isSolved(this.model),
      busy: this.animating || this.queue.length > 0 || this.scrambling,
      lastMove: this.lastMove,
      scrambling: this.scrambling,
    });
  }

  private frame = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const width = this.gl.drawingBufferWidth;
    const height = this.gl.drawingBufferHeight;
    if (width > 0 && height > 0 && (width !== this.bufferWidth || height !== this.bufferHeight)) {
      this.bufferWidth = width;
      this.bufferHeight = height;
      this.renderer.setSize(width, height, false);
    }
    // The present blits on the GL thread and leaves that framebuffer bound.
    // three skips the rebind while it still thinks the default framebuffer is
    // current, so later draws never reach the screen. Bind it explicitly, then
    // wait until this frame's blit is done. Without the wait, frames pile up
    // on the GL queue and the view keeps showing the first one.
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.renderer.render(this.scene, this.camera);
    this.gl.endFrameEXP();
    this.gl.getError();
  };
}

export const FACE_PAD: { token: string; face: Face }[] = [
  { token: 'U', face: 'U' },
  { token: "U'", face: 'U' },
  { token: 'D', face: 'D' },
  { token: "D'", face: 'D' },
  { token: 'L', face: 'L' },
  { token: "L'", face: 'L' },
  { token: 'R', face: 'R' },
  { token: "R'", face: 'R' },
  { token: 'F', face: 'F' },
  { token: "F'", face: 'F' },
  { token: 'B', face: 'B' },
  { token: "B'", face: 'B' },
];
