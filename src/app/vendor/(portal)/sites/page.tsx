import { requireVendorCompany, rows, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { SITE_TYPES } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionButton, ActionDialog } from "@/components/vendor/action-form";
import { archiveSite, saveSite, setDefaultSite } from "../actions";

export const metadata = { title: "Sites" };

type Site = { id: string; name: string; site_type: string; address_line1: string | null; address_line2: string | null; city: string | null; postcode: string | null;
  country_alpha2: string; locode: string | null; latitude: number | null; longitude: number | null; contact_name: string | null; contact_phone: string | null;
  is_default_dispatch: boolean; active: boolean };

function SiteFields({ s, countries }: { s?: Site; countries: { code: string; name: string }[] }) {
  const known = countries.some((c) => c.code === s?.country_alpha2);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div><label className="label" htmlFor="name">Site name</label><input id="name" name="name" required maxLength={200} className="input" defaultValue={s?.name} /></div>
      <div><label className="label" htmlFor="site_type">Type</label>
        <select id="site_type" name="site_type" className="input" defaultValue={s?.site_type ?? "manufacturing"}>{SITE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="address_line1">Address</label><input id="address_line1" name="address_line1" maxLength={300} className="input" defaultValue={s?.address_line1 ?? ""} /></div>
      <div className="sm:col-span-2"><input name="address_line2" maxLength={300} className="input" defaultValue={s?.address_line2 ?? ""} aria-label="Address line 2" placeholder="Address line 2 (optional)" /></div>
      <div><label className="label" htmlFor="city">City</label><input id="city" name="city" maxLength={120} className="input" defaultValue={s?.city ?? ""} /></div>
      <div><label className="label" htmlFor="postcode">Postcode</label><input id="postcode" name="postcode" maxLength={30} className="input" defaultValue={s?.postcode ?? ""} /></div>
      <div><label className="label" htmlFor="country_alpha2">Country</label>
        <select id="country_alpha2" name="country_alpha2" required className="input" defaultValue={s?.country_alpha2 ?? ""}>
          <option value="" disabled>Choose…</option>
          {!known && s && <option value={s.country_alpha2}>{s.country_alpha2}</option>}
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select></div>
      <div><label className="label" htmlFor="locode">UN/LOCODE</label><input id="locode" name="locode" maxLength={6} className="input uppercase" defaultValue={s?.locode ?? ""} placeholder="e.g. PLPOZ" /></div>
      <div><label className="label" htmlFor="latitude">Latitude</label><input id="latitude" name="latitude" inputMode="decimal" className="input" defaultValue={s?.latitude ?? ""} placeholder="52.4064" /></div>
      <div><label className="label" htmlFor="longitude">Longitude</label><input id="longitude" name="longitude" inputMode="decimal" className="input" defaultValue={s?.longitude ?? ""} placeholder="16.9252" /></div>
      <div><label className="label" htmlFor="contact_name">Site contact</label><input id="contact_name" name="contact_name" maxLength={200} className="input" defaultValue={s?.contact_name ?? ""} /></div>
      <div><label className="label" htmlFor="contact_phone">Phone</label><input id="contact_phone" name="contact_phone" maxLength={50} className="input" defaultValue={s?.contact_phone ?? ""} /></div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="is_default_dispatch" defaultChecked={s?.is_default_dispatch} /> Default dispatch site (goods ship from here unless an order says otherwise)</label>
    </div>
  );
}

export default async function SitesPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const [sites, countries] = await Promise.all([
    rows<Site>(supabase.from("supplier_sites").select("*").eq("active", true).order("name")),
    rows<{ code: string; name: string }>(supabase.from("markets").select("code, name").order("name")),
  ]);
  const act = canAct(ctx.permission);

  return (
    <>
      <PageHead title="Sites" sub="Where you make, store and ship from. adm Indicia uses your default dispatch site for logistics and carbon calculations, so keep it up to date. You can have one default.">
        {act && <ActionDialog label="Add site" variant="primary" title="Add a site" action={saveSite} submit="Save site" wide><SiteFields countries={countries} /></ActionDialog>}
      </PageHead>
      {sites.length === 0 ? <Card><Empty title="No sites yet">Add your factory and dispatch locations.</Empty></Card> : (
        <div className="grid gap-4 md:grid-cols-2">
          {sites.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><MSymbol name={s.site_type === "warehouse" || s.site_type === "distribution" ? "warehouse" : s.site_type === "office" ? "apartment" : "factory"} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-xs text-muted">{SITE_TYPES.find((t) => t.value === s.site_type)?.label}{s.locode ? ` · ${s.locode}` : ""}</p>
                </div>
                {s.is_default_dispatch && <Pill tone="ok">Default dispatch</Pill>}
              </div>
              <p className="text-sm">{[s.address_line1, s.address_line2, s.city, s.postcode, s.country_alpha2].filter(Boolean).join(", ")}</p>
              {(s.latitude !== null || s.contact_name) && <p className="text-xs text-muted">{s.latitude !== null ? `${s.latitude}, ${s.longitude}` : ""}{s.contact_name ? ` · ${s.contact_name}${s.contact_phone ? ` (${s.contact_phone})` : ""}` : ""}</p>}
              {act && (
                <div className="mt-auto flex flex-wrap gap-2">
                  <ActionDialog label="Edit" title={`Edit ${s.name}`} action={saveSite} submit="Save site" wide><SiteFields s={s} countries={countries} /></ActionDialog>
                  {!s.is_default_dispatch && <ActionButton action={setDefaultSite} label="Make default" hidden={{ id: s.id }} />}
                  <ActionButton action={archiveSite} label="Archive" variant="danger" hidden={{ id: s.id }} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
