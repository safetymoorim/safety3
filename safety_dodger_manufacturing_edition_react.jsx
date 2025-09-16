import React, { useEffect, useRef, useState } from "react";

// Safety Dodger – Manufacturing Edition
// Controls: ← → (or A/D). Mobile: on-screen buttons. Collect "Safety" blocks, avoid "Hazard" blocks.
// Leaderboard is stored locally in the browser (localStorage). Export/Import available via JSON.

const HAZARDS = [
  "TBM 미실시",
  "안전대 미착용",
  "방호장치 임의해제",
  "사다리 부적절 사용",
  "추락방지난간 미설치",
  "밀폐공간 절차 미준수",
  "L/TO 미실시",
  "보안경 미착용",
  "소화기 미비치",
  "작업허가서 미준수",
];

const SAFETIES = [
  "TBM 실시",
  "안전대 착용",
  "산소/유해가스 측정",
  "방호장치 정상가동",
  "안전난간 설치",
  "밀폐공간 절차 준수",
  "L/TO 실시",
  "PPE 착용",
  "소화기 점검",
  "작업허가서 준수",
];

const CANVAS_W = 420;
const CANVAS_H = 640;
const PLAYER_W = 60;
const PLAYER_H = 16;
const ITEM_W = 54;
const ITEM_H = 28;
const BASE_SPEED = 2.2;
const SPAWN_MS = 700; // base spawn rate, decreases over time

function randFrom<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type Item = {
  id: number;
  x: number;
  y: number;
  vy: number;
  type: "hazard" | "safety";
  label: string;
};

type RecordEntry = {
  name: string;
  dept: string;
  score: number;
  dateISO: string;
};

const STORAGE_KEY = "safety_dodger_lb_v1";

export default function SafetyDodger() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const idSeedRef = useRef<number>(1);
  const keysRef = useRef<{ [k: string]: boolean }>({});

  const [playerX, setPlayerX] = useState((CANVAS_W - PLAYER_W) / 2);
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [speedScale, setSpeedScale] = useState(1);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const [leaderboard, setLeaderboard] = useState<RecordEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as RecordEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importText, setImportText] = useState("");

  // Keyboard controls
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      if ((e.key === " " || e.key === "Enter") && !running && !gameOver) start();
      if (e.key === "p" && running) pause();
    };
    const onUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [running, gameOver]);

  // Game loop
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 16.6667; // normalized to 60fps
      last = now;

      if (running) {
        // Player movement
        const speed = 6.0 * dt;
        const left = keysRef.current["arrowleft"] || keysRef.current["a"];
        const right = keysRef.current["arrowright"] || keysRef.current["d"];
        setPlayerX((prev) => {
          const nx = prev + (right ? speed : 0) - (left ? speed : 0);
          return clamp(nx, 0, CANVAS_W - PLAYER_W);
        });

        // Spawn items
        if (now - lastSpawnRef.current > Math.max(180, SPAWN_MS / speedScale)) {
          lastSpawnRef.current = now;
          const isSafety = Math.random() < 0.55; // slightly more safety blocks
          const item: Item = {
            id: idSeedRef.current++,
            x: Math.random() * (CANVAS_W - ITEM_W),
            y: -ITEM_H,
            vy: (BASE_SPEED + Math.random() * 1.4) * speedScale,
            type: isSafety ? "safety" : "hazard",
            label: isSafety ? randFrom(SAFETIES) : randFrom(HAZARDS),
          };
          setItems((arr) => [...arr, item]);
        }

        // Increase difficulty slowly
        setSpeedScale((s) => clamp(s + 0.0007 * dt, 1, 3.5));

        // Move items & collisions
        setItems((arr) => {
          const next: Item[] = [];
          let gained = 0;
          for (const it of arr) {
            const ny = it.y + it.vy * dt * 3;
            const nx = it.x;
            // Collision with player
            const collide =
              ny + ITEM_H >= CANVAS_H - PLAYER_H - 6 &&
              nx < playerX + PLAYER_W &&
              nx + ITEM_W > playerX;

            if (collide) {
              if (it.type === "hazard") {
                endGame();
                return [];
              } else {
                gained += 1;
                continue; // collected; don't keep item
              }
            }
            if (ny < CANVAS_H + 40) next.push({ ...it, y: ny });
          }
          if (gained) setScore((sc) => sc + gained);
          return next;
        });
      }

      // Draw
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      // BG
      const grd = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      grd.addColorStop(0, "#0f172a");
      grd.addColorStop(1, "#111827");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Title bar
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "bold 18px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText(`Score: ${score}`, 12, 24);
      ctx.fillText(`Speed: x${speedScale.toFixed(2)}`, CANVAS_W - 150, 24);

      // Player
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(playerX, CANVAS_H - PLAYER_H - 6, PLAYER_W, PLAYER_H);

      // Items
      for (const it of items) {
        ctx.fillStyle = it.type === "hazard" ? "#ef4444" : "#3b82f6";
        // block
        roundRect(ctx, it.x, it.y, ITEM_W, ITEM_H, 6, true, false);
        // label
        ctx.fillStyle = "#f9fafb";
        ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto";
        const label = it.label.length > 12 ? it.label.slice(0, 12) + "…" : it.label;
        ctx.fillText(label, it.x + 6, it.y + 18);
      }

      if (!running && !gameOver) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 24px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.fillText("Safety Dodger", 120, 220);
        ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.fillText("Collect Safety, Avoid Hazards", 90, 250);
        ctx.fillText("Press Space to Start", 120, 280);
      }

      if (gameOver) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 28px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.fillText("GAME OVER", 135, 240);
        ctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.fillText(`Your Score: ${score}`, 145, 270);
        ctx.fillText("Enter info & Save to Leaderboard", 70, 300);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [running, gameOver, score, items, playerX, speedScale]);

  function start() {
    setItems([]);
    setScore(0);
    setSpeedScale(1);
    setGameOver(false);
    setRunning(true);
    lastSpawnRef.current = performance.now();
  }

  function pause() {
    setRunning(false);
  }

  function endGame() {
    setRunning(false);
    setGameOver(true);
  }

  function saveRecord() {
    if (!name.trim() || !dept.trim()) {
      alert("부서와 성함을 입력해주세요.");
      return;
    }
    const rec: RecordEntry = {
      name: name.trim(),
      dept: dept.trim(),
      score,
      dateISO: new Date().toISOString(),
    };
    const next = [...leaderboard, rec].sort((a, b) => b.score - a.score);
    setLeaderboard(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    // reset to title
    setGameOver(false);
  }

  function clearLB() {
    if (confirm("리더보드를 모두 삭제할까요?")) {
      localStorage.removeItem(STORAGE_KEY);
      setLeaderboard([]);
    }
  }

  function exportLB() {
    setShowExport(true);
  }

  function importLB() {
    try {
      const parsed = JSON.parse(importText) as RecordEntry[];
      const merged = [...leaderboard, ...parsed]
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
      setLeaderboard(merged);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      setImportText("");
      alert("가져오기 완료!");
    } catch (e) {
      alert("JSON 형식이 올바르지 않습니다.");
    }
  }

  // Touch controls for mobile
  const [touchDir, setTouchDir] = useState<"left" | "right" | null>(null);
  useEffect(() => {
    if (!touchDir) return;
    const id = setInterval(() => {
      setPlayerX((prev) => {
        const delta = touchDir === "left" ? -8 : 8;
        return clamp(prev + delta, 0, CANVAS_W - PLAYER_W);
      });
    }, 16);
    return () => clearInterval(id);
  }, [touchDir]);

  return (
    <div className="w-full min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center py-8">
      <div className="max-w-6xl w-full grid md:grid-cols-2 gap-6 px-4">
        {/* Left: Game */}
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-xl font-bold">Safety Dodger – 제조업 안전 에디션</h1>
              <div className="flex gap-2">
                {!running && !gameOver && (
                  <button className="px-3 py-1 rounded-xl bg-emerald-500 hover:bg-emerald-600" onClick={start}>
                    시작하기
                  </button>
                )}
                {running && (
                  <button className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-600" onClick={pause}>
                    일시정지(P)
                  </button>
                )}
                <button
                  className="px-3 py-1 rounded-xl bg-slate-600 hover:bg-slate-700"
                  onClick={() => {
                    setRunning(false);
                    setGameOver(false);
                    setItems([]);
                    setScore(0);
                    setSpeedScale(1);
                  }}
                >
                  리셋
                </button>
                <button
                  className="px-3 py-1 rounded-xl bg-slate-600 hover:bg-slate-700"
                  onClick={() => setShowHelp((v) => !v)}
                >
                  도움말
                </button>
              </div>
            </div>

            <div className="relative mx-auto w-[420px]">
              <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="rounded-2xl w-full border border-slate-700" />

              {/* Mobile controls */}
              <div className="md:hidden flex justify-between mt-3 select-none">
                <button
                  className="flex-1 mr-2 py-3 rounded-xl bg-slate-700 active:bg-slate-600"
                  onTouchStart={() => setTouchDir("left")}
                  onTouchEnd={() => setTouchDir(null)}
                >
                  ◀ 왼쪽
                </button>
                <button
                  className="flex-1 ml-2 py-3 rounded-xl bg-slate-700 active:bg-slate-600"
                  onTouchStart={() => setTouchDir("right")}
                  onTouchEnd={() => setTouchDir(null)}
                >
                  오른쪽 ▶
                </button>
              </div>

              {gameOver && (
                <div className="absolute inset-0 flex items-end justify-center pb-8">
                  <div className="bg-slate-800/80 backdrop-blur rounded-2xl p-4 w-[90%] border border-slate-700">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 text-center text-lg font-semibold">점수: {score}</div>
                      <input
                        className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 outline-none"
                        placeholder="부서"
                        value={dept}
                        onChange={(e) => setDept(e.target.value)}
                      />
                      <input
                        className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 outline-none"
                        placeholder="성함"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <button className="col-span-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700" onClick={saveRecord}>
                        리더보드에 등록
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {showHelp && (
              <div className="mt-3 text-sm text-slate-300 space-y-1">
                <p>조작: 방향키(←/→) 또는 A/D. 모바일은 화면 하단 버튼 사용.</p>
                <p>규칙: 파란 블록(안전요소)은 먹으면 +1점. 빨간 블록(불안전요소)을 맞으면 게임 종료.</p>
                <p>난이도는 시간이 지날수록 점점 빨라집니다.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Leaderboard & Admin */}
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">리더보드</h2>
              <div className="flex gap-2">
                <button className="px-3 py-1 rounded-xl bg-slate-600 hover:bg-slate-700" onClick={exportLB}>
                  내보내기
                </button>
                <button className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-700" onClick={clearLB}>
                  전체삭제
                </button>
              </div>
            </div>

            {leaderboard.length === 0 ? (
              <p className="text-slate-400 text-sm">등록된 기록이 없습니다. 게임을 플레이하고 등록해보세요.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-300">
                      <th className="py-2 pr-2">순위</th>
                      <th className="py-2 pr-2">부서</th>
                      <th className="py-2 pr-2">성함</th>
                      <th className="py-2 pr-2">점수</th>
                      <th className="py-2 pr-2">일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((r, i) => (
                      <tr key={i} className="border-t border-slate-700/60">
                        <td className="py-2 pr-2">{i + 1}</td>
                        <td className="py-2 pr-2">{r.dept}</td>
                        <td className="py-2 pr-2">{r.name}</td>
                        <td className="py-2 pr-2 font-semibold">{r.score}</td>
                        <td className="py-2 pr-2 text-slate-400">{new Date(r.dateISO).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showExport && (
              <div className="mt-4 space-y-3">
                <p className="text-slate-300 text-sm">리더보드 백업/공유를 위한 JSON입니다.</p>
                <textarea
                  className="w-full h-40 p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs"
                  readOnly
                  value={JSON.stringify(leaderboard, null, 2)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="flex items-center gap-2">
                  <textarea
                    className="flex-1 h-24 p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs"
                    placeholder="여기에 JSON 붙여넣기 후 '가져오기' 클릭"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                  <button className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={importLB}>
                    가져오기
                  </button>
                  <button className="px-3 py-2 rounded-xl bg-slate-600 hover:bg-slate-700" onClick={() => setShowExport(false)}>
                    닫기
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-800 rounded-2xl p-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-2">참여자 정보 (기본값)</h3>
            <p className="text-slate-300 text-sm mb-3">여기에 입력해두면 게임오버 시 자동으로 채워져요.</p>
            <div className="grid grid-cols-2 gap-3">
              <input
                className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 outline-none"
                placeholder="부서"
                value={dept}
                onChange={(e) => setDept(e.target.value)}
              />
              <input
                className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 outline-none"
                placeholder="성함"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">이 정보는 브라우저에만 저장됩니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: boolean,
  stroke: boolean
) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
