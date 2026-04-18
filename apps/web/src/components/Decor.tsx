/**
 * Background decoration shared by every page — matches the DAO.fund site's
 * scattered white/5 squares + neon-green radial glows aesthetic. Sits in
 * absolute-positioned, pointer-events-none so it never interferes with
 * clicks.
 */
export function Decor(): JSX.Element {
  // Positions cribbed from thedao.fund/ethsecurity-badges so the visual
  // rhythm matches the parent site. A few of them are green radial glows
  // (flagged with glow: true) — the rest are thin-border squares.
  const cells: Array<{ left: number; top: number; glow?: boolean }> = [
    { left: 40.38, top: 55.3 },
    { left: 1.99, top: 10.23 },
    { left: 64.23, top: 83.55 },
    { left: 45.97, top: 60.25 },
    { left: 41.62, top: 15.62 },
    { left: 71.59, top: 92.33 },
    { left: 4.22, top: 73.35 },
    { left: 13.76, top: 64.89 },
    { left: 9.03, top: 94.74 },
    { left: 76.96, top: 42.38 },
    { left: 99.28, top: 83.58 },
    { left: 72.15, top: 20.64 },
    { left: 93.37, top: 43.01, glow: true },
    { left: 17.1, top: 19.78, glow: true },
    { left: 36.47, top: 69.1, glow: true },
    { left: 64.68, top: 77.6, glow: true },
    { left: 71.1, top: 75.6, glow: true },
  ];

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {cells.map((c, i) =>
        c.glow ? (
          <div
            key={i}
            className="absolute w-32 h-32 rounded-lg"
            style={{
              left: `${c.left}%`,
              top: `${c.top}%`,
              background: "radial-gradient(circle, rgba(0,255,136,0.1) 0%, transparent 70%)",
            }}
          />
        ) : (
          <div
            key={i}
            className="absolute w-20 h-20 border border-white/5 rounded-lg"
            style={{ left: `${c.left}%`, top: `${c.top}%` }}
          />
        ),
      )}
    </div>
  );
}
