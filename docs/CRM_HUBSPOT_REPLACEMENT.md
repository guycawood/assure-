# CRM as the HubSpot replacement

CRM in System Guy replaces HubSpot. This is what adm Indicia uses HubSpot for today (from the Client Services
guides IWW326 Stakeholder Mapping, IWW327 Performance Tracker, IWW334 Customer Satisfaction Survey, Oct 2023;
form-submission exports on the Nestlé team sites; marketing and internal comms emails, 2026; the Data Domain
Owners sheet, which names HubSpot as the source for client contacts), and what CRM must do to take each job over.

## 1. Stakeholder mapping (contacts)
Today: one HubSpot view per client account, replacing an older Smartsheet. Reviewed quarterly.
- Contact fields: client account, contact owner and owner role (CP, BD, AM, MAM, RAD, TL, PM), department
  (Marketing / Procurement / other), relationship RAG, last contacted by AM/BD (date), frequency of contact,
  influencer level and decision-maker level (high / medium / low), services offered and services declined
  (multi-select), induction required (yes/no), receive survey (yes/no), legal basis for processing
  (default "legitimate interest - existing customer"). Mandatory fields marked.
- Stakeholder matrix (IEMG), worked out from influence x decision-maker level: Inform, Establish, Maintain, Grow,
  each with its engagement strategy and suggested actions. Hold the grid in a CRM Watchtower library so the
  mapping can be confirmed and changed under governance.
- Spreadsheet-style grid editing (click a cell to edit; date pickers; tick boxes for multi-selects), filter
  "my contacts" by owner, bulk reassign owner (leavers and new joiners), remove leavers.
- Access: staff see contacts for the accounts they work on; restricted views where GDPR requires; forms to add a
  new joiner to a client view and to open a new client space.
- Dashboard: RAG, contact frequency, influence and decision-maker levels, matrix, services to offer, owner role,
  department split.

## 2. Performance Tracker (opportunities)
Today: a custom object "Client Stakeholder Performance" attached to a contact. Reviewed weekly.
- Fields: company, contact, service, stage, next steps, CS lead, SME, total budget, probability, weighted
  budget (budget x probability), created timestamp, last updated.
- "Needs updating" when not touched for a set number of days.
- Dashboard: by next steps, stage, CS lead, SME, company, service; total and weighted budget; probability 50%+.

## 3. Customer satisfaction survey
Today: sent from HubSpot, results in Power BI. Twice a year (October half-year; March-April year end) or as the
contract says.
- 19 standard questions scored 1-5, mapped to the triple-fit grid, in sections: Strategy, Solutions, Knowledge
  and expertise, Processes and time to market, Relationships, Communication, People, Organisational structures,
  Technology and systems, Creativity and innovation, Sustainability; then NPS (0-10) and start / continue / stop;
  services awareness and interest; most valuable technology tools; testimonial or case-study opt-in.
- Any score of 3 or lower asks for a comment (internal only).
- Sent to contacts flagged "receive survey", as an email signed by the contact owner; result link on the contact.
- Dashboard: responses, overall rating, NPS and categories, client engagement, section scores, regions,
  services awareness; filters by client, country, NPS category and customer feeling; comment word cloud.

## 4. Forms, events and job surveys
- Forms and landing pages: event registration and event feedback (e.g. Nestlé innovation workshops), QR codes
  on stands pointing to a form, submissions exported to Excel today.
- Online job survey after delivery: project number, spend, overall experience (e.g. Nespresso). In System Guy
  this should go out when a job closes in Order Management.

## 5. Email to lists, with tracking
- Marketing emails to signed-off mailing lists (e.g. the annual sustainability report).
- Internal comms with open and engagement tracking (pulse surveys, programme updates).
- "Check who has read your communication" is a stated reason people use HubSpot.
- Suppliers: mass communications to vendors were named as a HubSpot use; in System Guy that belongs to SRM and
  the vendor portal.

## 6. Data and reporting
- HubSpot is the named source for client contacts in the data domain model; Power BI reads from it today.
- CRM must export the same data (CSV) and expose BI-ready views.

## 7. Moving off HubSpot
- Import HubSpot exports (companies, contacts, deals, the Client Stakeholder Performance custom object, form
  submissions, survey results) with field mapping, duplicate detection and a dry run; keep the HubSpot record ID
  on each imported row for traceability.
- Consent: carry the legal basis and email opt-out across; unsubscribes are honoured on every send.
- Run both in parallel until each account's owners sign off, then switch HubSpot to read-only.
