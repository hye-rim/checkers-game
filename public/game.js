'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 체커: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_CHECKERS), 방·매칭은 server.js
(() => {
const L = LOGIC_CHECKERS;
const { N } = L;
const $ = (id) => document.getElementById(id);
const COLORS = ['#ff5a4f', '#3d8bff'];
const SIDE_NAME = ['빨강', '파랑'];
const T = { cpu: 650, over: 900 };                          // 시간(ms). 시험용으로 줄일 수 있다

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('checkersWins')) || 0;
const ONLINE_KEY = 'checkersOnline', SESSION_KEY = 'checkersSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('checkersName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('checkersMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  select: () => tone(620, 0.05, 'triangle', 0.06),
  move: () => tone(330, 0.07, 'triangle', 0.08),
  capture: (n) => seq(Array.from({ length: Math.min(3, n) }, (_, i) => 300 + i * 90), 70, 'square', 0.06),
  king: () => seq([523, 784, 1047], 90, 'triangle', 0.1),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('checkersMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판 (나는 0번 빨강)
let lastMove = null;                // 마지막 수 { from, path, captured } (컴퓨터 모드, 온라인은 room.lastMove)
let sel = -1, via = [];             // 고른 말과 지금까지 고른 착지 칸들 (연속 뛰기 도중)
let room = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '', seenMove = 0;
let cpuTimer = 0, overTimer = 0;
const online = () => mode === 'online';

// 화면에 그릴 모양으로 (나는 you 번, 아래쪽)
function model() {
  if (online()) {
    if (!room) return null;
    return { board: room.board, turn: room.turn, you: room.you, state: room.state, winner: room.winner, reason: room.reason, last: room.lastMove, quiet: room.quiet,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  return { board: st.board, turn: st.turn, you: 0, state: st.winner >= 0 ? 'over' : 'playing', winner: st.winner, reason: st.reason, last: lastMove, quiet: st.quiet, names: ['나', '컴퓨터'] };
}
const viewOf = (m) => ({ board: m.board, turn: m.turn, winner: -1, reason: '', quiet: m.quiet, plies: 0, rand: Math.random });
const myTurn = (m) => !!m && m.state === 'playing' && m.turn === m.you && !netDown;
const canAct = (m) => myTurn(m) && !waitingNet;

// ---------- 그리기 ----------
const sqEls = [];
function buildBoard() {
  const b = $('board');
  b.innerHTML = '';
  sqEls.length = 0;
  for (let k = 0; k < N * N; k++) {
    const el = document.createElement('div');
    el.className = 'sq';
    el.dataset.k = String(k);
    el.onclick = () => onSquare(k);
    b.appendChild(el); sqEls.push(el);
  }
}
// 화면 칸 k(0~63, 왼쪽 위부터) ↔ 판 칸 번호. 내가 파랑이면 판을 뒤집어 내 말이 늘 아래에 오게 한다
const flipped = () => { const m = model(); return !!m && m.you === 1; };
const toIdx = (k) => (flipped() ? N * N - 1 - k : k);
const toView = (i) => (flipped() ? N * N - 1 - i : i);

function legalFor(m) { return canAct(m) ? L.legalMoves(viewOf(m)) : []; }
function render() {
  const m = model();
  if (!m) { renderHud(null); return; }
  const legal = legalFor(m);
  const movable = new Set(legal.map((x) => x.from));
  const dests = new Set(), caps = new Set(), viaSet = new Set(via);
  if (sel >= 0) {
    for (const mv of legal) {
      if (mv.from !== sel || mv.path.length <= via.length || !via.every((v, i) => mv.path[i] === v)) continue;
      dests.add(mv.path[via.length]);
      if (via.length === 0 && mv.captured.length) {/* 잡는 말 표시는 선택 후 아래에서 */}
    }
    for (const mv of legal) if (mv.from === sel && via.every((v, i) => mv.path[i] === v)) for (const c of mv.captured.slice(0, via.length + 1)) caps.add(c);
  }
  const last = new Set(m.last ? [m.last.from, ...m.last.path] : []);
  for (let k = 0; k < N * N; k++) {
    const i = toIdx(k), el = sqEls[k], v = m.board[i];
    const dk = L.dark(i);
    el.className = 'sq' + (dk ? ' dk' : '') + (last.has(i) ? ' last' : '') + (dests.has(i) ? ' dest' : '') + (viaSet.has(i) ? ' via' : '') + (caps.has(i) ? ' cap' : '');
    el.innerHTML = '';
    if (v) {
      const p = document.createElement('div');
      p.className = 'pc' + (L.isKing(v) ? ' king' : '') + (movable.has(i) && sel < 0 ? ' can' : '') + (i === sel ? ' sel' : '');
      p.style.setProperty('--c', COLORS[L.sideOf(v)]);
      el.appendChild(p);
    }
  }
  const mine = m.you, opp = 1 - m.you;
  const bar = (el, side) => {
    const cnt = L.count({ board: m.board }, side);
    el.style.setProperty('--c', COLORS[side]);
    el.className = 'bar' + (m.state === 'playing' && m.turn === side ? ' turn' : '');
    el.innerHTML = `<span class="dot" style="--c:${COLORS[side]}"></span><span class="nm">${esc(m.names[side])} (${SIDE_NAME[side]})</span><span class="ct">말 ${cnt}개</span>`;
  };
  bar($('barOp'), opp); bar($('barMe'), mine);
  renderHud(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '체커';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.turn === m.you) text = `내 차례${online() ? ` · ${sec}초` : ''}`;
    else text = online() ? `${m.names[m.turn]} 차례 · ${sec}초` : '컴퓨터 생각 중…';
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }
function turnHint(m) {
  if (!myTurn(m)) return;
  const legal = L.legalMoves(viewOf(m));
  const hint = legal.length && legal[0].captured.length ? '⚔️ 잡을 수 있는 말이 있어요! 반드시 잡아야 해요' : '내 말을 눌러서 고르고, 갈 칸을 눌러요';
  const cur = $('msg').textContent;
  say(cur && !cur.includes('눌러') ? `${cur}\n${hint}` : hint);
}

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 내 수 고르기 ----------
function resetPick() { sel = -1; via = []; }
function onSquare(k) {
  const m = model();
  if (!canAct(m)) return;
  const i = toIdx(k);
  const legal = L.legalMoves(viewOf(m));
  const v = m.board[i];
  if (sel < 0) {                                          // 말을 고른다
    if (!v || L.sideOf(v) !== m.you) return;
    if (!legal.some((x) => x.from === i)) {
      sfx.bad();
      say(legal[0] && legal[0].captured.length ? '⚔️ 잡을 수 있는 말이 있어서, 잡는 말만 움직일 수 있어요' : '그 말은 움직일 수 없어요');
      return;
    }
    sel = i; via = []; sfx.select(); tutorialSignal('select'); render();
    return;
  }
  if (i === sel && via.length === 0) { resetPick(); render(); return; }          // 같은 말을 다시 누르면 취소
  if (v && L.sideOf(v) === m.you && via.length === 0 && legal.some((x) => x.from === i)) { sel = i; sfx.select(); render(); return; }   // 다른 내 말로 바꿔 고르기
  const next = legal.filter((x) => x.from === sel && via.every((p, j) => x.path[j] === p) && x.path.length > via.length && x.path[via.length] === i);
  if (!next.length) { sfx.bad(); return; }
  const path = via.concat([i]);
  const done = next.find((x) => x.path.length === path.length);
  if (!done) { via = path; sfx.select(); render(); return; }                       // 연속 뛰기: 다음 착지 칸을 이어서 고른다
  const from = sel;
  resetPick();
  doMove(from, path);
}
function doMove(from, path) {
  if (online()) { waitingNet = true; net.send('move', { from, path }); render(); return; }
  const r = L.move(st, from, path);
  if (!r) return;
  lastMove = { from: r.from, path: r.path, captured: r.captured, crowned: r.crowned };
  announce(0, lastMove);
  tutorialSignal('move'); if (r.captured.length) tutorialSignal('capture'); if (r.crowned) tutorialSignal('king');
  render();
  afterMove();
}
function announce(who, mv) {
  const mine = who === (model() || { you: 0 }).you;
  if (mv.captured.length) { sfx.capture(mv.captured.length); say(`${mine ? '내가' : '상대가'} ${mv.captured.length}개를 잡았어요!${mv.crowned ? ' 👑 왕이 됐어요!' : ''}`); }
  else { sfx.move(); say(mv.crowned ? `${mine ? '내' : '상대'} 말이 👑 왕이 됐어요!` : ''); }
  if (mv.crowned) sfx.king();
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; st = L.newGame(); phase = 'play'; lastMove = null; resetPick(); turnEnd = 0;
  hideOverlay(); buildBoard(); render();
  say('빨강이 먼저예요! 내 말을 눌러서 고르고, 갈 칸을 눌러요');
}
function afterMove() {
  if (st.winner >= 0) { overTimer = setTimeout(showOver, T.over); return; }
  render();
  cpuTimer = setTimeout(cpuTurn, T.cpu);
}
function cpuTurn() {
  if (phase !== 'play' || !st || st.winner >= 0 || st.turn !== 1 || online()) return;
  const mv = L.aiPick(st, mode === 'hard' ? 'hard' : 'easy');
  if (!mv) return;
  const r = L.move(st, mv.from, mv.path);
  lastMove = { from: r.from, path: r.path, captured: r.captured, crowned: r.crowned };
  announce(1, lastMove);
  render();
  if (st.winner >= 0) { overTimer = setTimeout(showOver, T.over); return; }
  turnHint(model());
}
function showOver() {
  phase = 'over';
  const youWon = st.winner === 0, draw = st.winner === 2;
  if (youWon) { wins++; store.set('checkersWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  const why = { captured: youWon ? '상대 말을 모두 잡았어요!' : '내 말이 모두 잡혔어요', blocked: youWon ? '상대가 더 움직일 수 없어요!' : '내 말이 움직일 수 없게 됐어요', draw: '잡거나 맨을 움직이지 않고 80수가 지나 비겼어요' }[st.reason] || '';
  showOverlay(`
    <h2>${draw ? '무승부! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>${esc(why)}</p>
    <dl class="stats card2"><dt>내 말</dt><dd>${L.count(st, 0)}개</dd><dt>컴퓨터 말</dt><dd>${L.count(st, 1)}개</dd><dt>둔 수</dt><dd>${st.plies}수</dd></dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = L.newGame(); lastMove = null; resetPick();
  buildBoard(); say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>체커</h1>
    <p>상대 말을 <b>뛰어넘어 잡아서</b> 모두 없애면 이겨요!</p>
    <div class="card2" style="font-size:13px">말은 대각선 <b>앞으로 한 칸</b>씩 가요<br>상대 말 뒤 칸이 비어 있으면 <b>뛰어넘어 잡아요</b> (연속으로도!)<br>⚔️ 잡을 수 있으면 <b>반드시</b> 잡아야 해요<br>끝 줄에 닿으면 👑 <b>왕</b> — 뒤로도 갈 수 있어요</div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      // 프록시가 WebSocket ping 을 대신 받아버리는 환경이 있어 살아있다는 신호를 직접 보낸다
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;   // 일부러 닫은 연결
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        // 대국 중이면 계속 다시 붙어본다. 서버는 30초 동안 자리를 비워둔다.
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const fresh = !room || room.code !== r.code;
  const newGame = fresh || room.games !== r.games;
  room = r;
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  resetPick();
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; buildBoard(); say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say(r.turn === r.you ? '내가 먼저 둬요! 내 말을 눌러요' : '상대가 먼저 둬요'); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  const m = model();
  if (r.lastMove && r.lastMove.seq > seenMove && !newGame) { seenMove = r.lastMove.seq; announce(r.lastMove.who, r.lastMove); if (r.lastMove.who === r.you) { tutorialSignal('move'); if (r.lastMove.captured.length) tutorialSignal('capture'); if (r.lastMove.crowned) tutorialSignal('king'); } }
  render();
  if (r.state === 'playing' && !(r.lastMove && r.lastMove.seq > seenMove)) { const mm = model(); if (r.lastMove && r.lastMove.who !== r.you) turnHint(mm); }
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) { rec.d = (rec.d || 0) + 1; sfx.found(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const draw = r.winner === 2, won = r.winner === r.you;
  const why = {
    captured: won ? '상대 말을 모두 잡았어요!' : '내 말이 모두 잡혔어요',
    blocked: won ? '상대가 더 움직일 수 없어요!' : '내 말이 움직일 수 없게 됐어요',
    draw: '잡거나 맨을 움직이지 않고 80수가 지나 비겼어요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${why}</p>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패${rec.d ? ` ${rec.d}무` : ''}</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; st = null; waitingNet = false; resetPick();
  buildBoard(); say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 수에 60초 · 빨강(먼저)과 파랑은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('checkersName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '체커 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && e.code === 'KeyM') toggleMute(); });
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
// 초대 링크(?room=CODE)로 들어왔거나, 새로고침 전에 하던 대국이 있으면 온라인으로 바로 간다
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  buildBoard();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__ck = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get sel() { return sel; }, T, onSquare, startCpu, render, toView, toIdx };
/* @test-hooks:end */
})();
