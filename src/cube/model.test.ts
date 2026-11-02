import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyMove,
  createSolvedCube,
  invertMove,
  isSolved,
  moveToken,
  parseMove,
  scrambleMoves,
} from './model.ts';

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('cube model', () => {
  it('starts solved', () => {
    assert.equal(isSolved(createSolvedCube()), true);
    assert.equal(createSolvedCube().length, 26);
  });

  it('round-trips face notation', () => {
    for (const token of ["U", "U'", 'U2', 'D', "L'", 'R', 'F2', "B'"]) {
      assert.equal(moveToken(parseMove(token)), token);
    }
  });

  it('cycles the up-front-right corner on U', () => {
    const cube = createSolvedCube();
    applyMove(cube, parseMove('U'));
    const corner = cube.find((cubie) => cubie.home[0] === 1 && cubie.home[1] === 1 && cubie.home[2] === 1);
    assert.deepEqual(corner?.pos, [-1, 1, 1]);
    assert.equal(isSolved(cube), false);
  });

  it('returns to solved after four quarter turns', () => {
    const cube = createSolvedCube();
    for (let i = 0; i < 4; i += 1) applyMove(cube, parseMove('R'));
    assert.equal(isSolved(cube), true);
  });

  it('returns to solved after six sexy moves', () => {
    const cube = createSolvedCube();
    const sexy = ['R', 'U', "R'", "U'"].map(parseMove);
    for (let i = 0; i < 6; i += 1) {
      for (const move of sexy) applyMove(cube, move);
    }
    assert.equal(isSolved(cube), true);
  });

  it('returns to solved when a scramble is inverted', () => {
    const cube = createSolvedCube();
    const moves = scrambleMoves(40, mulberry32(7));
    for (const move of moves) applyMove(cube, move);
    assert.equal(isSolved(cube), false);
    for (const move of [...moves].reverse()) applyMove(cube, invertMove(move));
    assert.equal(isSolved(cube), true);
  });

  it('treats a displaced piece as unsolved', () => {
    const cube = createSolvedCube();
    const edge = cube.find((cubie) => cubie.home[0] === 0 && cubie.home[1] === 1 && cubie.home[2] === 1);
    assert.ok(edge);
    edge.pos = [1, 1, 0];
    assert.equal(isSolved(cube), false);
  });
});
