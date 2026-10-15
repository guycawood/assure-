"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { MSymbol } from "@/components/symbol";
import { searchKey } from "@/lib/taxonomy-shared";

export type SearchOption = { value: string; label: string; hint?: string };

/** Searchable single select (combobox): type to filter, arrows + Enter to choose, Esc to close. No dependencies. */
export function SearchSelect({ id, value, onChange, options, placeholder = "Choose…", disabled, emptyText = "Nothing matches", label, invalid }: {
  id?: string; value: string; onChange: (v: string) => void; options: SearchOption[]; placeholder?: string; disabled?: boolean;
  emptyText?: string; label?: string; invalid?: boolean;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = searchKey(query);
    if (!q) return options;
    return options.filter((o) => searchKey(`${o.label} ${o.hint ?? ""}`).includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (v: string) => { onChange(v); setOpen(false); setQuery(""); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (open && filtered[active]) { e.preventDefault(); choose(filtered[active].value); } }
    else if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); setQuery(""); } }
  };

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          className={clsx("input pr-14", invalid && "border-bad")}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : selected?.label ?? ""}
          onFocus={() => { setOpen(true); setActive(0); }}
          onClick={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={onKey}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-0.5 text-muted">
          {value && !disabled && (
            <button type="button" tabIndex={-1} className="pointer-events-auto grid h-6 w-6 place-items-center rounded hover:bg-surface-2"
              aria-label="Clear" onMouseDown={(e) => { e.preventDefault(); choose(""); }}>
              <MSymbol name="close" size={16} />
            </button>
          )}
          <MSymbol name="unfold_more" size={18} />
        </span>
      </div>
      {open && !disabled && (
        <ul ref={list} id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-raised">
          {filtered.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{emptyText}</li> : filtered.map((o, i) => (
            <li
              key={o.value}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={clsx("flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm", i === active && "bg-surface-2", o.value === value && "font-semibold")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(o.value); }}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
