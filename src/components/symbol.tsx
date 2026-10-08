import { clsx } from "clsx";

/**
 * Google Material Symbols (Rounded), the icon set named in the adm Indicia brand guidelines (fonts.google.com/icons).
 * The font is loaded in the root layout. `name` is the symbol's ligature, e.g. "local_shipping".
 */
export function MSymbol({ name, size = 20, fill, className, style, label }: {
  name: string; size?: number; fill?: boolean; className?: string; style?: React.CSSProperties; label?: string;
}) {
  return (
    <span
      className={clsx("material-symbols-rounded select-none leading-none", className)}
      style={{ fontSize: size, fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 450, 'GRAD' 0, 'opsz' ${Math.min(48, Math.max(20, size))}`, ...style }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      {name}
    </span>
  );
}
