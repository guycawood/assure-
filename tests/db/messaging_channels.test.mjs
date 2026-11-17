// WhatsApp and WeChat on SRM conversations: contacts with opt-in, the reply window, templates, the outbound queue with retries and delivery
// receipts, and inbound replies filed into the vendor's conversation (or held when the sender is unknown). Sender and webhook functions are not user-callable.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const U = { vend: "00000000-0000-0000-0000-0000000001c1", other: "00000000-0000-0000-0000-0000000001c2", sus: "00000000-0000-0000-0000-0000000001c3" };
Object.assign(ids, U);
const mk = async (code, email) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, `Chan ${code}`, email])).rows[0].id;
const S = await mk("CH-A", "a@chan.example"), S2 = await mk("CH-B", "b@chan.example");
await asSuper("insert into auth.users (id, email) values ($1,'a@chan.example'), ($2,'b@chan.example'), ($3,'sus@adm-indicia.com')", [U.vend, U.other, U.sus]);
await as("admin", "select public.division_role_assign($1,'assure','sustainability',null)", [U.sus]);
const conv = (await asSuper("insert into public.conversations (supplier_id, subject) values ($1,'RFQ chat') returning id", [S])).rows[0].id;
const sys = (sql, p) => asSuper(sql, p);
const claim = async () => (await sys("select public.messaging_claim(20) as c")).rows[0].c;
const inbound = async (addr, body, ext = null) => (await sys("select public.messaging_inbound('whatsapp',$1,$2,$3,'Anna') as r", [addr, body, ext])).rows[0].r;
let wa;

test("contacts: staff record the opt-in evidence, a vendor adds their own, numbers are normalised and unique per company", async () => {
  await rejects(as("admin", "select public.messaging_contact_add($1,'whatsapp','12345',null,null)", [S]), /country code/);
  wa = (await as("admin", "select public.messaging_contact_add($1,'whatsapp','+49 151 2345 6789','Anna',null) as id", [S])).rows[0].id;
  assert.equal((await asSuper("select status, address from public.supplier_message_contacts where id = $1", [wa])).rows[0].status, "pending");   // no evidence yet
  await rejects(as("admin", "select public.messaging_contact_opt_in($1,'')", [wa]), /how the vendor agreed/);
  await as("admin", "select public.messaging_contact_opt_in($1,'Email confirmation 12 Nov')", [wa]);
  const c = (await asSuper("select status, address, opt_in_method from public.supplier_message_contacts where id = $1", [wa])).rows[0];
  assert.deepEqual([c.status, c.address, c.opt_in_method], ["opted_in", "4915123456789", "Email confirmation 12 Nov"]);
  await rejects(as("admin", "select public.messaging_contact_add($1,'whatsapp','+4915123456789','x','call')", [S2]), /another company/);
  const wc = (await as("vend", "select public.messaging_contact_add($1,'wechat','anna_wx','Anna',null) as id", [S])).rows[0].id;
  assert.equal((await asSuper("select status, opt_in_method from public.supplier_message_contacts where id = $1", [wc])).rows[0].status, "opted_in");
  await rejects(as("vend", "select public.messaging_contact_add($1,'wechat','other_wx','x',null)", [S2]), /Not your company/);
  assert.equal((await as("vend", "select public.messaging_contacts(null) as l")).rows[0].l.length, 2);                                          // vendors see only their own
  assert.equal((await as("other", "select public.messaging_contacts(null) as l")).rows[0].l.length, 0);
});

test("sending needs an opted-in contact; free text only inside the reply window, otherwise an approved template", async () => {
  await rejects(as("admin", "select public.messaging_send($1,$2,'Hello',null,'{}')", [conv, "00000000-0000-0000-0000-000000000001"]), /does not belong/);
  await rejects(as("admin", "select public.messaging_send($1,$2,'Hello',null,'{}')", [conv, wa]), /reply window is closed/);                      // the vendor has not written yet
  await rejects(as("admin", "select public.messaging_send($1,$2,null,'rfq_invitation','{Anna}')", [conv, wa]), /Fill in every field/);
  const out = (await as("admin", "select public.messaging_send($1,$2,null,'rfq_invitation','{Anna,RFQ-7,20 Nov}') as id", [conv, wa])).rows[0].id;
  const m = (await asSuper("select m.body, m.channel, m.sender_side from public.messages m join public.message_outbound o on o.message_id = m.id where o.id = $1", [out])).rows[0];
  assert.deepEqual([m.channel, m.sender_side], ["whatsapp", "internal"]);
  assert.match(m.body, /Hello Anna, you have a new quote request \(RFQ-7\) waiting in the vendor portal\. Please respond by 20 Nov\./);
  await as("admin", "select public.messaging_template_set_status('rfq_invitation','draft')");
  await rejects(as("admin", "select public.messaging_send($1,$2,null,'rfq_invitation','{A,B,C}')", [conv, wa]), /not approved/);
  await as("admin", "select public.messaging_template_set_status('rfq_invitation','approved')");
  await rejects(as("vend", "select public.messaging_send($1,$2,'Hi',null,'{}')", [conv, wa]), /./);                                              // vendors cannot send through the queue
});

test("the queue: claim, retry with backoff, permanent failure, and delivery receipts only move forward", async () => {
  const q = await claim();
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].channel, q[0].kind, q[0].address, q[0].template.name], ["whatsapp", "template", "4915123456789", "rfq_invitation"]);
  assert.equal((await claim()).length, 0);                                                                                                         // already claimed
  await sys("select public.messaging_result($1,false,null,'Provider busy',false)", [q[0].id]);
  let o = (await asSuper("select status, attempts, error, next_attempt_at > now() as later from public.message_outbound where id = $1", [q[0].id])).rows[0];
  assert.deepEqual([o.status, o.attempts, o.error, o.later], ["queued", 1, "Provider busy", true]);
  await asSuper("update public.message_outbound set next_attempt_at = now() where id = $1", [q[0].id]);
  await claim();
  await sys("select public.messaging_result($1,true,'wamid.1',null,false)", [q[0].id]);
  await sys("select public.messaging_delivery('whatsapp','wamid.1','read',null)");
  await sys("select public.messaging_delivery('whatsapp','wamid.1','delivered',null)");                                                           // an older receipt arriving late
  assert.equal((await asSuper("select status from public.message_outbound where id = $1", [q[0].id])).rows[0].status, "read");
  const out2 = (await as("admin", "select public.messaging_send($1,$2,null,'po_issued','{Anna,PO-1}') as id", [conv, wa])).rows[0].id;
  const q2 = await claim();
  await sys("select public.messaging_result($1,false,null,'Number not on WhatsApp',true)", [q2[0].id]);
  o = (await asSuper("select status, error from public.message_outbound where id = $1", [out2])).rows[0];
  assert.deepEqual([o.status, o.error], ["failed", "Number not on WhatsApp"]);
  assert.equal((await as("admin", "select public.messaging_outbound_for($1) as l", [conv])).rows[0].l.length, 2);
});

test("an inbound reply opens the window, lands in the vendor's conversation, and is de-duplicated", async () => {
  const r = await inbound("+49 151 2345 6789", "Yes, we can quote by Friday", "wamid.in1");
  assert.deepEqual([r.result, r.conversation_id], ["attached", conv]);
  const m = (await asSuper("select body, sender_side, channel, sender from public.messages where external_id = 'wamid.in1'")).rows[0];
  assert.deepEqual([m.body, m.sender_side, m.channel, m.sender], ["Yes, we can quote by Friday", "supplier", "whatsapp", null]);
  assert.equal((await inbound("+49 151 2345 6789", "Yes, we can quote by Friday", "wamid.in1")).result, "duplicate");
  const ch = (await as("admin", "select public.messaging_conversation_channels($1) as c", [conv])).rows[0].c.find((x) => x.channel === "whatsapp");
  assert.deepEqual([ch.free_text_ok, ch.window_hours, ch.tail], [true, 24, "6789"]);
  const out = (await as("admin", "select public.messaging_send($1,$2,'Great, thanks',null,'{}') as id", [conv, wa])).rows[0].id;                 // free text now allowed
  assert.ok(out);
  await asSuper("update public.supplier_message_contacts set last_inbound_at = now() - interval '25 hours' where id = $1", [wa]);
  await rejects(as("admin", "select public.messaging_send($1,$2,'Later',null,'{}')", [conv, wa]), /reply window is closed/);                      // 24 hours passed
});

test("STOP opts a contact out and blocks sending; START opts back in; the channel field cannot be forged from a client", async () => {
  assert.equal((await inbound("4915123456789", "STOP", "wamid.in2")).result, "opted_out");
  await rejects(as("admin", "select public.messaging_send($1,$2,null,'po_issued','{A,B}')", [conv, wa]), /not opted in/);
  assert.equal((await inbound("4915123456789", "start", "wamid.in3")).result, "opted_in");
  await as("vend", "select public.messaging_contact_opt_out($1)", [(await asSuper("select id from public.supplier_message_contacts where channel = 'wechat'")).rows[0].id]);
  assert.equal((await asSuper("select count(*)::int n from public.supplier_message_contacts where status = 'opted_out'")).rows[0].n, 1);
  await as("vend", "insert into public.messages (conversation_id, body, channel) values ($1,'sneaky','whatsapp')", [conv]);
  assert.equal((await asSuper("select channel from public.messages where body = 'sneaky'")).rows[0].channel, "portal");
});

test("a message from an unknown number is held; staff link it to a vendor with the opt-in evidence, or dismiss it", async () => {
  assert.equal((await inbound("+44 7700 900123", "Is this the right number for Chan CH-B?", "wamid.u1")).result, "unmatched");
  assert.equal((await inbound("+44 7700 900123", "Is this the right number for Chan CH-B?", "wamid.u1")).result, "duplicate");
  const list = (await as("admin", "select public.messaging_unmatched() as l")).rows[0].l;
  assert.equal(list.length, 1);
  await rejects(as("admin", "select public.messaging_unmatched_attach($1,$2,'')", [list[0].id, S2]), /how the vendor agreed/);
  const r = (await as("admin", "select public.messaging_unmatched_attach($1,$2,'They wrote to us first') as r", [list[0].id, S2])).rows[0].r;
  assert.equal(r.result, "attached");
  assert.equal((await asSuper("select count(*)::int n from public.conversations where supplier_id = $1", [S2])).rows[0].n, 1);                    // a conversation was opened for them
  assert.equal((await as("admin", "select public.messaging_unmatched() as l")).rows[0].l.length, 0);
  await inbound("+1 202 555 0100", "wrong number", "wamid.u2");
  await as("admin", "select public.messaging_unmatched_dismiss($1)", [(await as("admin", "select public.messaging_unmatched() as l")).rows[0].l[0].id]);
  assert.equal((await as("admin", "select public.messaging_unmatched() as l")).rows[0].l.length, 0);
});

test("templates and window rules are governed by the SRM owners; sender and webhook functions are not callable by users", async () => {
  await rejects(as("sus", "select public.messaging_template_save('late_ship','Late shipment','Hello {{1}}, order {{2}} is late.','late_ship','en')"), /SRM owners/);
  await as("admin", "select public.messaging_template_save('late_ship','Late shipment','Hello {{1}}, order {{2}} is late.','late_ship','en')");
  assert.equal((await asSuper("select status from public.message_templates where key = 'late_ship'")).rows[0].status, "draft");                  // new wording waits for approval
  await as("admin", "select public.messaging_template_set_status('late_ship','approved')");
  await as("admin", "select public.messaging_template_save('late_ship','Late shipment','Hello {{1}}, order {{2}} will be late.','late_ship','en')");
  assert.equal((await asSuper("select status from public.message_templates where key = 'late_ship'")).rows[0].status, "draft");                  // changed wording must be approved again
  await rejects(as("sus", "select public.messaging_channel_set_window('whatsapp', 12)"), /SRM owners/);
  await as("admin", "select public.messaging_channel_set_window('wechat', null)");                                                                // WeCom has no reply window
  assert.equal((await asSuper("select window_hours from public.messaging_channel_settings where channel = 'wechat'")).rows[0].window_hours, null);
  for (const sql of ["select public.messaging_claim(5)", "select public.messaging_result(gen_random_uuid(),true,null,null,false)", "select public.messaging_delivery('whatsapp','x','read',null)", "select public.messaging_inbound('whatsapp','+4912345678','hi',null,null)"]) {
    await rejects(as("admin", sql), /permission denied|does not exist/);
  }
  assert.equal((await as("vend", "select count(*)::int n from public.message_outbound")).rows[0].n, 0);                                           // vendors see no queue rows
});
