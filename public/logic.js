'use strict';

// 체커(영국식 드래프트): 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 8x8 판의 어두운 칸에만 말을 둔다. 양쪽 12개씩. 0 번 편(빨강)이 아래에서 위로, 1 번 편(파랑)이 위에서 아래로 가며 빨강이 먼저 둔다
// - 일반 말(맨)은 대각선 앞으로 한 칸. 앞 대각선에 상대 말이 있고 그 뒤 칸이 비어 있으면 뛰어넘어 잡는다 (맨은 뒤로는 못 움직이고 못 잡는다)
// - **잡을 수 있으면 반드시 잡아야 한다.** 한 번 잡은 뒤 또 잡을 수 있으면 같은 말로 이어서 잡는다 (연속 뛰기). 잡는 길이 여러 개면 아무거나 골라도 된다
// - 맨이 맨 끝 줄에 닿으면 왕이 된다. 맨이 뛰어서 끝 줄에 닿으면 왕이 되고 그 차례는 끝난다. 왕은 대각선 앞뒤 어느 쪽으로든 한 칸 가고 잡는다
// - 상대 말이 없거나 움직일 수 없게 하면 이긴다. 잡거나 맨을 움직이지 않고 80수(양쪽 40번씩)가 지나면 비긴다
const LOGIC_CHECKERS = (() => {
const N = 8;
const EMPTY = 0, MAN = [1, 3], KING = [2, 4];            // 말 번호: 0 빈칸 · 1 빨강 맨 · 2 빨강 왕 · 3 파랑 맨 · 4 파랑 왕
const sideOf = (v) => (v === 0 ? -1 : v <= 2 ? 0 : 1);
const isKing = (v) => v === 2 || v === 4;
const DRAW_PLIES = 80;
const rc = (i) => [(i / N) | 0, i % N];
const idx = (r, c) => r * N + c;
const inside = (r, c) => r >= 0 && c >= 0 && r < N && c < N;
const dark = (i) => { const [r, c] = rc(i); return (r + c) % 2 === 1; };

function newGame(opts = {}) {
  const board = new Array(N * N).fill(0);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if ((r + c) % 2 !== 1) continue;
    if (r < 3) board[idx(r, c)] = 3;                      // 파랑은 위쪽 세 줄
    else if (r > 4) board[idx(r, c)] = 1;                 // 빨강은 아래쪽 세 줄
  }
  return { board, turn: 0, winner: -1, reason: '', quiet: 0, plies: 0, rand: opts.rand || Math.random };
}

// 말 v 가 한 칸 가는 방향들 (빨강은 위(행이 줄어드는 쪽), 파랑은 아래)
function dirs(v) {
  if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return sideOf(v) === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}
const promotionRow = (side) => (side === 0 ? 0 : N - 1);

// 이 말이 잡으며 갈 수 있는 모든 연속 뛰기 길 (잡은 말은 판에 남은 채로 두고 같은 말을 두 번 못 잡는다)
function jumpsFrom(board, from, v, taken) {
  const out = [];
  function go(pos, piece, path, caps) {
    let any = false;
    for (const [dr, dc] of dirs(piece)) {
      const [r, c] = rc(pos);
      const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
      if (!inside(tr, tc)) continue;
      const mid = idx(mr, mc), to = idx(tr, tc);
      if (sideOf(board[mid]) !== 1 - sideOf(piece) || caps.includes(mid)) continue;
      if (board[to] !== 0 && to !== from) continue;       // 도착 칸은 비어 있어야 한다 (내가 떠난 자리는 비어 있는 셈)
      any = true;
      const crown = !isKing(piece) && tr === promotionRow(sideOf(piece));
      if (crown) out.push({ from, path: [...path, to], captured: [...caps, mid], crowned: true });
      else go(to, piece, [...path, to], [...caps, mid]);
    }
    if (!any && caps.length) out.push({ from, path, captured: caps, crowned: false });
  }
  go(from, v, [], []);
  return out;
}

// 지금 둘 수 있는 수 전부. 잡을 수 있으면 잡는 수만 (강제 잡기)
function legalMoves(st, side = st.turn) {
  if (st.winner >= 0) return [];
  const caps = [], steps = [];
  for (let i = 0; i < N * N; i++) {
    const v = st.board[i];
    if (sideOf(v) !== side) continue;
    for (const m of jumpsFrom(st.board, i, v, null)) caps.push(m);
    for (const [dr, dc] of dirs(v)) {
      const [r, c] = rc(i), nr = r + dr, nc = c + dc;
      if (!inside(nr, nc) || st.board[idx(nr, nc)] !== 0) continue;
      steps.push({ from: i, path: [idx(nr, nc)], captured: [], crowned: !isKing(v) && nr === promotionRow(side) });
    }
  }
  return caps.length ? caps : steps;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// 수를 둔다. from: 말이 있는 칸, path: 거쳐 가는 칸들(한 칸 이동이면 한 칸, 연속 뛰기면 착지 칸마다).
// 규칙에 어긋나면 null, 아니면 { from, path, captured, crowned, over }
function move(st, from, path) {
  if (st.winner >= 0 || !Array.isArray(path) || !path.length) return null;
  if (!path.every((x) => Number.isInteger(x) && x >= 0 && x < N * N) || !Number.isInteger(from)) return null;
  const m = legalMoves(st).find((x) => x.from === from && same(x.path, path));
  if (!m) return null;
  const v = st.board[from];
  const side = st.turn;
  st.board[from] = 0;
  for (const c of m.captured) st.board[c] = 0;
  const end = m.path[m.path.length - 1];
  st.board[end] = m.crowned ? (side === 0 ? 2 : 4) : v;
  st.plies++;
  if (m.captured.length || !isKing(v)) st.quiet = 0; else st.quiet++;
  st.turn = 1 - side;
  if (!st.board.some((x) => sideOf(x) === st.turn) || !legalMoves(st).length) { st.winner = side; st.reason = !st.board.some((x) => sideOf(x) === st.turn) ? 'captured' : 'blocked'; }
  else if (st.quiet >= DRAW_PLIES) { st.winner = 2; st.reason = 'draw'; }          // 2 = 무승부
  return { from, path: m.path, captured: m.captured, crowned: m.crowned, over: st.winner >= 0 };
}

const count = (st, side) => st.board.filter((v) => sideOf(v) === side).length;
const clone = (st) => ({ board: st.board.slice(), turn: st.turn, winner: st.winner, reason: st.reason, quiet: st.quiet, plies: st.plies, rand: st.rand });

// 어느 말이 어떤 수를 둘 수 있는지 (화면이 고를 수 있는 말을 알려 줄 때 쓴다)
const movablePieces = (st) => [...new Set(legalMoves(st).map((m) => m.from))];

// ---------- 컴퓨터 ----------
// 평가: 내 편이 유리할수록 큰 값. 말 수가 가장 중요하고, 왕·앞으로 나간 정도·가운데·뒷줄 지키기를 조금 본다
function evaluate(st, side) {
  let s = 0;
  for (let i = 0; i < N * N; i++) {
    const v = st.board[i];
    if (!v) continue;
    const owner = sideOf(v), [r, c] = rc(i);
    let val = isKing(v) ? 160 : 100;
    if (!isKing(v)) val += (owner === 0 ? N - 1 - r : r) * 4;                       // 앞으로 나갈수록(왕에 가까울수록)
    if (!isKing(v) && ((owner === 0 && r === N - 1) || (owner === 1 && r === 0))) val += 8;  // 뒷줄을 지키는 말
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) val += 3;                             // 가운데
    s += owner === side ? val : -val;
  }
  return s;
}
function search(st, depth, alpha, beta, side) {
  if (st.winner >= 0) return st.winner === 2 ? 0 : st.winner === side ? 10000 + depth : -10000 - depth;
  if (depth === 0) return evaluate(st, side);
  const moves = legalMoves(st);
  moves.sort((a, b) => b.captured.length - a.captured.length);                      // 잡는 수를 먼저 봐서 가지치기가 잘 되게
  const maximizing = st.turn === side;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const c = clone(st);
    move(c, m.from, m.path);
    const v = search(c, depth - 1, alpha, beta, side);
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (beta <= alpha) break;
  }
  return best;
}
// level: 'easy' 는 35% 는 아무 수나 두고 나머지는 2수 앞만 보며, 'hard' 는 6수 앞을 보고, 'best' 는 8수 앞을 본다 (시험·비교용)
const DEPTH = { easy: 2, hard: 6, best: 8 };
const EASY_RANDOM = 0.35;
function aiPick(st, level, rand = st.rand) {
  const moves = legalMoves(st);
  if (!moves.length) return null;
  if (moves.length === 1 || (level === 'easy' && rand() < EASY_RANDOM)) return moves[Math.floor(rand() * moves.length)];
  const depth = DEPTH[level] || DEPTH.hard;
  let best = [], bs = -Infinity;
  for (const m of moves) {
    const c = clone(st);
    move(c, m.from, m.path);
    const v = search(c, depth - 1, -Infinity, Infinity, st.turn);
    if (v > bs) { bs = v; best = [m]; } else if (v === bs) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}

return { N, DRAW_PLIES, sideOf, isKing, rc, idx, dark, newGame, legalMoves, move, count, clone, movablePieces, evaluate, aiPick };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_CHECKERS;
