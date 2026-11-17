import { Stat } from "@/components/ui";
import { gradeLetter } from "@/components/impact-grade/grade-badge";

/** Average Impact Grade as a headline tile: the letter and score, and how many specs it is built from. Used on supplier, vendor, client and client-portal pages. */
export function GradeStat({ avg, specs, graded, of, label = "Impact Grade (average)", icon }: {
  avg: number | null; specs: number; graded: number; of: string; label?: string; icon?: React.ReactNode;
}) {
  const g = gradeLetter(avg);
  return (
    <Stat
      label={label}
      value={g ? <span style={{ color: g.colour }}>{g.letter} <span className="text-[1.1rem]">{Number(avg).toFixed(0)}</span></span> : "—"}
      hint={specs > 0 ? `Average of ${graded} graded of ${specs} specs on ${of}` : `No specs on ${of} yet`}
      icon={icon}
    />
  );
}
