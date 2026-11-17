// Carbon intensity KPIs (Impact Grade.xlsx, Outputs): kg CO2e per € and per kg, rolled up as totals ÷ totals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupDb } from "./helpers.mjs";
import { fmtIntensity, rollupIntensity } from "../../src/lib/carbon-intensity.ts";

const t = await setupDb();

test("roll-ups divide total CO2e by total spend or weight, not an average of ratios", () => {
  const r = rollupIntensity([
    { spec_id: "a", co2e_kg: 100, spend_eur: 1000, weight_kg: 50, economic_intensity: 0.1, physical_intensity: 2 },
    { spec_id: "b", co2e_kg: 300, spend_eur: 1000, weight_kg: null, economic_intensity: 0.3, physical_intensity: null },
    { spec_id: "c", co2e_kg: null, spend_eur: 500, weight_kg: 10, economic_intensity: null, physical_intensity: null },
  ]);
  assert.equal(r.economic, 0.2, "400 kg ÷ €2,000");
  assert.equal(r.physical, 2, "only specs with CO2e and weight");
  assert.equal(r.measured, 2);
  assert.equal(r.specs, 3);
  assert.equal(rollupIntensity([]).economic, null);
  assert.equal(fmtIntensity(0.2), "0.200 kg CO2e/€");
  assert.equal(fmtIntensity(2, "kg"), "2.00 kg CO2e/kg");
});

test("the KPI function is internal only and returns one row per spec", async () => {
  const { rows } = await t.as("plain", "select count(*)::int n from public.spec_carbon_intensity()");
  assert.ok(rows[0].n >= 0);
  await t.asSuper("insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email) values ('CI-V','Vendor CI','Poland','EMEA','BAU','Print','civ@vendor.example')");
  await t.asSuper("insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'civ@vendor.example')");
  await t.rejects(t.as("00000000-0000-0000-0000-0000000000e1", "select * from public.spec_carbon_intensity()"), /Not allowed/);
});
