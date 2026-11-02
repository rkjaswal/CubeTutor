export type Axis = 0 | 1 | 2;
export type Sign = -1 | 1;
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Face = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';

export type Cubie = {
  home: Vec3;
  pos: Vec3;
  quat: Quat;
};

export type Move = {
  axis: Axis;
  layer: -1 | 0 | 1;
  dir: Sign;
  turns: 1 | 2;
};

export const FACE_COLOR: Record<Face, string> = {
  U: '#f4f6f8',
  D: '#f5d000',
  L: '#ff6b1a',
  R: '#c41e3a',
  F: '#00a651',
  B: '#0051ba',
};

const FACE_MOVE: Record<Face, Pick<Move, 'axis' | 'layer' | 'dir'>> = {
  U: { axis: 1, layer: 1, dir: -1 },
  D: { axis: 1, layer: -1, dir: 1 },
  R: { axis: 0, layer: 1, dir: -1 },
  L: { axis: 0, layer: -1, dir: 1 },
  F: { axis: 2, layer: 1, dir: -1 },
  B: { axis: 2, layer: -1, dir: 1 },
};

const FACES: Face[] = ['U', 'D', 'L', 'R', 'F', 'B'];
const OPPOSITE: Record<Face, Face> = {
  U: 'D',
  D: 'U',
  L: 'R',
  R: 'L',
  F: 'B',
  B: 'F',
};

const IDENTITY: Quat = [0, 0, 0, 1];

export function createSolvedCube(): Cubie[] {
  const cubies: Cubie[] = [];
  for (const x of [-1, 0, 1] as const) {
    for (const y of [-1, 0, 1] as const) {
      for (const z of [-1, 0, 1] as const) {
        if (x === 0 && y === 0 && z === 0) continue;
        cubies.push({
          home: [x, y, z],
          pos: [x, y, z],
          quat: [...IDENTITY],
        });
      }
    }
  }
  return cubies;
}

export function parseMove(token: string): Move {
  const face = token[0] as Face;
  const base = FACE_MOVE[face];
  if (!base) throw new Error(`Unknown move ${token}`);
  if (token[1] === '2') return { ...base, turns: 2 };
  if (token[1] === "'") {
    return { ...base, dir: base.dir === 1 ? -1 : 1, turns: 1 };
  }
  return { ...base, turns: 1 };
}

export function moveToken(move: Move): string | null {
  for (const face of FACES) {
    const base = FACE_MOVE[face];
    if (base.axis !== move.axis || base.layer !== move.layer) continue;
    if (move.turns === 2) return `${face}2`;
    return move.dir === base.dir ? face : `${face}'`;
  }
  return null;
}

export function invertMove(move: Move): Move {
  if (move.turns === 2) return { ...move };
  return { ...move, dir: move.dir === 1 ? -1 : 1 };
}

export function applyMove(cubies: Cubie[], move: Move): void {
  const axisVec: Vec3 = [0, 0, 0];
  axisVec[move.axis] = 1;
  const quarter = quatFromAxisAngle(axisVec, (move.dir * Math.PI) / 2);

  for (let step = 0; step < move.turns; step += 1) {
    for (const cubie of cubies) {
      if (cubie.pos[move.axis] !== move.layer) continue;
      cubie.pos = rotatePos(cubie.pos, move.axis, move.dir);
      cubie.quat = normalizeQuat(quatMul(quarter, cubie.quat));
    }
  }
}

export function isSolved(cubies: readonly Cubie[]): boolean {
  for (const cubie of cubies) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (cubie.pos[axis] !== cubie.home[axis]) return false;
      const home = cubie.home[axis];
      if (home === 0) continue;
      const local: Vec3 = [0, 0, 0];
      local[axis] = home;
      const world = quatRotate(cubie.quat, local);
      if (
        Math.abs(world[0] - local[0]) > 1e-3 ||
        Math.abs(world[1] - local[1]) > 1e-3 ||
        Math.abs(world[2] - local[2]) > 1e-3
      ) {
        return false;
      }
    }
  }
  return true;
}

export function scrambleMoves(length = 25, random: () => number = Math.random): Move[] {
  const moves: Move[] = [];
  let previous: Face | null = null;
  let beforeThat: Face | null = null;

  while (moves.length < length) {
    const face = FACES[Math.floor(random() * FACES.length)];
    if (face === previous) continue;
    if (previous && face === OPPOSITE[previous] && beforeThat === face) continue;
    const roll = random();
    const token = roll < 0.25 ? `${face}'` : roll < 0.5 ? `${face}2` : face;
    moves.push(parseMove(token));
    beforeThat = previous;
    previous = face;
  }

  return moves;
}

export function rotatePos(pos: Vec3, axis: Axis, dir: Sign): Vec3 {
  const [x, y, z] = pos;
  if (axis === 0) return dir === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return dir === 1 ? [z, y, -x] : [-z, y, x];
  return dir === 1 ? [-y, x, z] : [y, -x, z];
}

function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function normalizeQuat(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
