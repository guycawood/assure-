import Link from "next/link";

// One look for the Impact Grade wherever a spec appears (briefing, sourcing, RFQ, orders, logistics, execution, SRM).
// Letters follow the grade letters library defaults (A 80+, B 60+, C 40+, D 20+, E below); the Impact Grade
// Watchtower governs them and every badge links there.

const LETTERS: [number, string, string][] = [[80, "A", "#2f9e6b"], [60, "B", "#5aa86a"], [40, "C", "#d9a032"], [20, "D", "#e07b3c"], [0, "E", "#d64545"]];

export function gradeLetter(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
  const s = Number(score);
  const [, letter, colour] = LETTERS.find(([min]) => s >= min) ?? LETTERS[LETTERS.length - 1];
  return { letter, colour };
}

// href null = no link (vendor and client portals: those users cannot open the internal Watchtower).
export function ImpactGradeBadge({ score, floor, href = "/impact-grade/watchtower/grade", compact }: {
  score: number | null | undefined; floor?: number | null; href?: string | null; compact?: boolean;
}) {
  const g = gradeLetter(score);
  const below = g && floor !== null && floor !== undefined && Number(score) < floor;
  const title = g ? `Impact Grade ${g.letter} · ${Number(score).toFixed(0)} of 100${below ? ` · below the client's floor of ${floor}` : ""}` : "Impact Grade not calculated yet";
  const style = g ? { borderColor: g.colour, color: g.colour } : { borderColor: "#cbd5d5", color: "#6b7c7c" };
  const cls = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[0.7rem] font-bold leading-none";
  const inner = <><span aria-hidden>●</span>{g ? `${g.letter}${compact ? "" : ` ${Number(score).toFixed(0)}`}` : "IG –"}{below && <span className="text-bad">↓ floor</span>}</>;
  return href === null
    ? <span title={title} className={cls} style={style}>{inner}</span>
    : <Link href={href} title={title} className={`${cls} hover:opacity-80`} style={style}>{inner}</Link>;
}
