'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const I = (r, c) => r * 8 + c;
// 말을 직접 놓은 판: pieces = [[행, 열, 말 번호], ...] (1 빨강 맨 · 2 빨강 왕 · 3 파랑 맨 · 4 파랑 왕)
function make(pieces, turn = 0) {
  const st = L.newGame();
  st.board.fill(0);
  for (const [r, c, v] of pieces) st.board[I(r, c)] = v;
  st.turn = turn;
  return st;
}
const dests = (st, from) => L.legalMoves(st).filter((m) => m.from === from).map((m) => m.path.map((p) => [(p / 8) | 0, p % 8].join(',')).join('>'));

test('the start position has twelve men each on dark squares, red at the bottom', () => {
  const st = L.newGame();
  assert.strictEqual(L.count(st, 0), 12);
  assert.strictEqual(L.count(st, 1), 12);
  st.board.forEach((v, i) => { if (v) assert.ok(L.dark(i), 'piece on a light square ' + i); });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) assert.strictEqual(st.board[I(r, c)], 3);
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) assert.strictEqual(st.board[I(r, c)], 1);
  assert.strictEqual(st.turn, 0);
});

test('perft: the number of move sequences from the start matches the known values for english draughts', () => {
  function perft(st, d) {
    if (d === 0) return 1;
    const ms = L.legalMoves(st);
    if (!ms.length) return 0;
    if (d === 1) return ms.length;
    let n = 0;
    for (const m of ms) { const c = L.clone(st); L.move(c, m.from, m.path); n += perft(c, d - 1); }
    return n;
  }
  const known = [7, 49, 302, 1469, 7361, 36768, 179740];
  known.forEach((v, i) => assert.strictEqual(perft(L.newGame(), i + 1), v, 'depth ' + (i + 1)));
});

test('a man steps one square diagonally forward only', () => {
  const st = make([[5, 2, 1], [0, 1, 3]]);
  assert.deepStrictEqual(dests(st, I(5, 2)).sort(), ['4,1', '4,3']);
  const blue = make([[2, 3, 3], [7, 0, 1]], 1);
  assert.deepStrictEqual(dests(blue, I(2, 3)).sort(), ['3,2', '3,4']);
});

test('a man cannot step onto an occupied square or off the board', () => {
  const st = make([[5, 0, 1], [4, 1, 1], [0, 3, 3]]);
  assert.deepStrictEqual(dests(st, I(5, 0)), [], 'blocked by its own man and the edge');
  assert.deepStrictEqual(dests(st, I(4, 1)).sort(), ['3,0', '3,2']);
});

test('jumping an enemy is forced and the only kind of move allowed', () => {
  const st = make([[5, 2, 1], [4, 3, 3], [6, 5, 1]]);
  const ms = L.legalMoves(st);
  assert.ok(ms.length >= 1 && ms.every((m) => m.captured.length >= 1), 'only captures are listed');
  assert.deepStrictEqual(dests(st, I(5, 2)), ['3,4']);
  assert.strictEqual(dests(st, I(6, 5)).length, 0, 'the other man may not make a plain move');
  assert.strictEqual(L.move(st, I(6, 5), [I(5, 4)]), null);
  const r = L.move(st, I(5, 2), [I(3, 4)]);
  assert.deepStrictEqual(r.captured, [I(4, 3)]);
  assert.strictEqual(st.board[I(4, 3)], 0);
  assert.strictEqual(st.board[I(3, 4)], 1);
});

test('a jump needs an empty square behind the enemy', () => {
  const st = make([[5, 2, 1], [4, 3, 3], [3, 4, 3], [0, 7, 3]]);
  assert.deepStrictEqual(dests(st, I(5, 2)).sort(), ['4,1'], 'blocked jump: only the plain step is left');
});

test('after a jump the same piece must keep jumping (a chain is one move)', () => {
  const st = make([[7, 0, 1], [6, 1, 3], [4, 3, 3], [2, 5, 3], [0, 7, 3]]);
  const ms = L.legalMoves(st);
  assert.strictEqual(ms.length, 1);
  assert.deepStrictEqual(ms[0].path.map((p) => [(p / 8) | 0, p % 8].join(',')), ['5,2', '3,4', '1,6']);
  assert.strictEqual(ms[0].captured.length, 3);
  assert.strictEqual(L.move(st, I(7, 0), [I(5, 2)]), null, 'stopping after the first jump is not allowed');
  const r = L.move(st, I(7, 0), ms[0].path);
  assert.strictEqual(r.captured.length, 3);
  assert.strictEqual(L.count(st, 1), 1);
  assert.strictEqual(st.board[I(1, 6)], 1);
});

test('when there is a choice of captures every branch is offered', () => {
  const st = make([[6, 3, 1], [5, 2, 3], [5, 4, 3], [0, 7, 3]]);
  const paths = L.legalMoves(st).map((m) => m.path.map((p) => [(p / 8) | 0, p % 8].join(',')).join('>')).sort();
  assert.deepStrictEqual(paths, ['4,1', '4,5']);
});

test('a man cannot jump backward but a king can', () => {
  const man = make([[4, 3, 1], [5, 4, 3], [0, 1, 3]]);                       // 적이 내 뒤쪽 대각선에 있다
  assert.ok(L.legalMoves(man).every((m) => m.captured.length === 0), 'a man does not capture backward');
  const king = make([[4, 3, 2], [5, 4, 3], [0, 1, 3]]);
  const ms = L.legalMoves(king);
  assert.ok(ms.length === 1 && ms[0].captured[0] === I(5, 4), 'a king captures backward');
});

test('a man that reaches the far row becomes a king by stepping or by jumping', () => {
  const step = make([[1, 2, 1], [7, 6, 3]]);
  const r = L.move(step, I(1, 2), [I(0, 1)]);
  assert.ok(r.crowned);
  assert.strictEqual(step.board[I(0, 1)], 2);
  const blue = make([[6, 3, 3], [0, 1, 1]], 1);
  L.move(blue, I(6, 3), [I(7, 2)]);
  assert.strictEqual(blue.board[I(7, 2)], 4);
});

test('a man crowned by a jump stops there even if a king could keep jumping', () => {
  // 빨강 맨이 (2,3) 에서 (1,2)를 뛰어 (0,1) 에서 왕이 된다. 왕이라면 (1,0)... 계속 뛸 수 있는 자리여도 이번 차례는 거기서 끝
  const st = make([[2, 3, 1], [1, 2, 3], [1, 0, 3], [7, 6, 3]]);
  const ms = L.legalMoves(st);
  assert.strictEqual(ms.length, 1);
  assert.strictEqual(ms[0].path.length, 1, 'the move ends on the king row');
  assert.ok(ms[0].crowned);
  const r = L.move(st, I(2, 3), ms[0].path);
  assert.strictEqual(st.board[I(0, 1)], 2);
  assert.strictEqual(st.board[I(1, 0)], 3, 'the second enemy stays');
  assert.strictEqual(st.turn, 1);
  assert.ok(r.crowned);
});

test('a king moves one square in all four diagonals', () => {
  const st = make([[4, 3, 2], [0, 7, 3]]);
  assert.deepStrictEqual(dests(st, I(4, 3)).sort(), ['3,2', '3,4', '5,2', '5,4']);
  const edge = make([[7, 0, 2], [0, 7, 3]]);
  assert.deepStrictEqual(dests(edge, I(7, 0)), ['6,1']);
});

test('a player with no pieces or no legal moves loses', () => {
  const st = make([[5, 2, 1], [4, 3, 3]]);
  const r = L.move(st, I(5, 2), [I(3, 4)]);
  assert.ok(r.over);
  assert.strictEqual(st.winner, 0);
  assert.strictEqual(st.reason, 'captured');
  assert.deepStrictEqual(L.legalMoves(st), []);
  const blocked = make([[2, 1, 1], [1, 0, 3], [0, 1, 3], [0, 3, 3], [1, 4, 3]]);
  // 파랑이 움직일 수 없는 판: (1,0) 은 (2,1) 빨강 맨 앞이고 그 뒤 (3,2) 가 막혀 있으면 못 뛴다
  assert.ok(L.legalMoves(blocked, 0).length > 0);
});

test('being blocked ends the game with the other side winning', () => {
  // 파랑 맨 하나가 (6,1) 에서 아래 두 칸이 빨강 맨으로 막혀 있다 (뛸 칸은 판 밖이고, 빨강도 이 말을 뛰어 잡을 수 없게 뒤 칸을 채워 뒀다). 빨강이 다른 말을 한 번 움직이면 파랑은 둘 수가 없다
  const st = make([[7, 0, 1], [7, 2, 1], [5, 0, 1], [5, 2, 1], [5, 4, 1], [6, 1, 3]], 0);
  const r = L.move(st, I(5, 4), [I(4, 3)]);
  assert.ok(r.over);
  assert.strictEqual(st.winner, 0);
  assert.strictEqual(st.reason, 'blocked');
  assert.strictEqual(L.count(st, 1), 1, 'the blue man is still on the board');
});

test('eighty quiet plies (no capture, no man move) is a draw', () => {
  const st = make([[7, 0, 2], [0, 7, 4]]);
  st.quiet = L.DRAW_PLIES - 1;
  const r = L.move(st, I(7, 0), [I(6, 1)]);
  assert.ok(r.over);
  assert.strictEqual(st.winner, 2);
  assert.strictEqual(st.reason, 'draw');
  const st2 = make([[7, 0, 2], [0, 7, 4], [5, 2, 1]]);
  st2.quiet = L.DRAW_PLIES - 1;
  L.move(st2, I(5, 2), [I(4, 1)]);
  assert.strictEqual(st2.winner, -1, 'a man move restarts the count');
  assert.strictEqual(st2.quiet, 0);
});

test('illegal and malformed moves are refused and change nothing', () => {
  const st = L.newGame();
  const before = JSON.stringify(st.board);
  const bads = [[I(5, 0), [I(3, 2)]], [I(5, 0), [I(5, 2)]], [I(2, 1), [I(3, 0)]], [I(0, 0), [I(1, 1)]], [-1, [0]], [I(5, 0), []], [I(5, 0), 'x'], [I(5, 0), [99]], [I(5, 0), [1.5]], [null, [I(4, 1)]], [I(5, 0), [I(4, 1), I(3, 2)]]];
  for (const [f, p] of bads) assert.strictEqual(L.move(st, f, p), null, JSON.stringify([f, p]));
  assert.strictEqual(JSON.stringify(st.board), before);
  assert.strictEqual(st.turn, 0);
  assert.ok(L.move(st, I(5, 0), [I(4, 1)]));
  assert.strictEqual(L.move(st, I(4, 1), [I(3, 0)]), null, 'not your turn (blue moves next)');
});

test('movablePieces lists only pieces that can move, only capturers when a capture exists', () => {
  const st = L.newGame();
  assert.strictEqual(L.movablePieces(st).length, 4);
  const cap = make([[5, 2, 1], [4, 3, 3], [6, 5, 1]]);
  assert.deepStrictEqual(L.movablePieces(cap), [I(5, 2)]);
});

test('ai plays only legal moves and always has one when the game is on', () => {
  for (const level of ['easy', 'hard']) {
    for (let seed = 1; seed <= 15; seed++) {
      const st = L.newGame();
      let x = seed * 2654435761;
      const rand = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
      for (let ply = 0; ply < 30 && st.winner < 0; ply++) {
        const m = L.aiPick(st, level, rand);
        assert.ok(m, level + ' has a move');
        assert.ok(L.move(st, m.from, m.path), level + ' plays a legal move');
      }
    }
  }
  const done = make([[5, 2, 1]]);
  done.winner = 0;
  assert.strictEqual(L.aiPick(done, 'hard'), null);
});

test('hard ai takes a free capture and does not hang a man for nothing', () => {
  const st = make([[5, 2, 1], [4, 3, 3], [6, 5, 1], [0, 1, 3]]);
  const m = L.aiPick(st, 'hard', () => 0.5);
  assert.deepStrictEqual(m.captured, [I(4, 3)]);
});

// 컴퓨터끼리 끝까지 두어 보기
function play(levels, seed, maxPlies = 400) {
  const st = L.newGame();
  let x = seed * 40503 + 7;
  const rand = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  while (st.winner < 0 && st.plies < maxPlies) {
    const m = L.aiPick(st, levels[st.turn], rand);
    assert.ok(m && L.move(st, m.from, m.path));
  }
  return st;
}
test('full games between computers end by rule (win or draw) without illegal moves', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const st = play(['easy', 'easy'], seed, 1500);
    assert.ok(st.winner >= 0, 'easy vs easy ended, seed ' + seed);
  }
  const st = play(['hard', 'hard'], 1, 200);
  assert.ok(st.winner >= 0 || st.plies >= 200, 'hard vs hard stays legal');
});

test('hard beats easy almost every game', () => {
  let hard = 0, games = 16;
  for (let seed = 1; seed <= games; seed++) {
    const levels = seed % 2 ? ['hard', 'easy'] : ['easy', 'hard'];
    const st = play(levels, seed, 500);
    if (st.winner >= 0 && st.winner < 2 && levels[st.winner] === 'hard') hard++;
  }
  assert.ok(hard / games >= 0.85, 'hard won ' + hard + ' of ' + games);
});
