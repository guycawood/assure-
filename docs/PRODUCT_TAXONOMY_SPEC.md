# Product taxonomy: specification

Source: the product taxonomy spec exported from the Base44 prototype (Oct 2026), adapted for System Guy
(Next.js + Postgres). The taxonomy is governed in the master Watchtower.

## 1. Purpose
One stable, governed naming tree for everything adm Indicia buys and produces, used by specifications, orders,
spend reporting and analytics. Rules:
1. **Stable taxonomy, changing materials.** The taxonomy classifies products (what the item is). Materials live on
   each specification's bill of materials, because materials change per job while the taxonomy is stable.
2. **The full path is stored.** Every consuming record stores category, subcategory and product type (when set),
   never only the leaf, so reporting rolls up at any level.
3. **Governed writes, audited changes.** Reads open to all signed-in users; writes admin-only; every create,
   update, delete, toggle and reorder goes to an append-only audit log with who, what and a plain description.

## 2. Access
Read: all signed-in users. Write: admins. Cross-system mappings: admins only (read and write).

## 3. Entities
- **Form type** (top level, fixed list): Print, Packaging, POS & Display, Creative & Design, Logistics, Merchandise,
  Digital, Custom Goods & Services, 2D/3D, Stocktool only.
- **Category** (under a form type): code (unique within the form type), name, description, active, display order.
- **Subcategory** (under a category): code (unique within the category), name, description, active, display order.
- **Product type** (the leaf; what consuming records reference): code (unique within the subcategory), name, default
  HS code (a starting value only: specs inherit it and override it where the material differs; customs documents
  read the spec's HS code, never this one), description, active, display order.
- **Aliases**: historic, local-language, misspelled or alternative terms mapped to exactly one node (category,
  subcategory or product type), with source system and source reference, so imports and free text resolve.
- **Cross-system mappings** with a review workflow: source system (ADM, Indicia, Stocktool, Airtable, Sourcing
  Hub), the external form type / category / subcategory / product type as they appear, the mapped internal nodes,
  status (Unmapped, Suggested, Pending review, Approved, Rejected, Archived), confidence score (0-1), reviewed by /
  at, notes.
- **Taxonomy audit log** (append-only, shared across taxonomy domains: Product, Client, Finance, Geography, DOA):
  record type, name, code, action, plain description, changed by.

## 4. The taxonomy picker
One shared cascading selector used by every product-classification field:
- Value: { form_type, category_id, subcategory_id, product_type_id }.
- Steps: Form type → Category → Subcategory → Product type (optional); searchable at each level; upstream change
  clears downstream; breadcrumb of the chosen path underneath.
- Props: requireSubcategory (default true), showProductType (default true).

## 5. Consumption rules
- Records store the form type (where needed) plus category, subcategory and product type ids; never free-text
  category names. Display names are stored alongside for lists.
- Spec HS code is seeded from the product type's default at spec creation, then owned by the spec.
- Spend and analytics roll up by category or subcategory from the stored ids. Alias resolution happens at import
  time, never at read time.
- Imports from other systems arrive as mapping rows (Unmapped / Suggested); an admin approves them before the
  external value counts as mapped.

## 6. Admin UI (master Watchtower → Taxonomy)
Domain tabs (Product first; Client, Finance, Geography later); product tree (categories grouped by form type,
subcategories of the selected category, product types of the selected subcategory) with code, name, description,
active toggle and order; dialog editors with parent pickers and code uniqueness; deactivation warns when children or
consuming records use the node; Aliases tab; Mappings queue (filter by source system and status, approve / reject
with reviewer and time); Audit trail tab. Admin-only actions, server-side search, every change audited.
