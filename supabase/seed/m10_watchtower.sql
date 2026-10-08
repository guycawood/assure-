-- Watchtower library records (demo). Indicative values for demonstration only: verify factors against the
-- licensed sources before any real reporting. Codes are referenced by the module seeds that load after this file.

insert into public.library_records (library_key, code, name, data, status, effective_from, notes) values
-- Core principles (governed with maker-checker; seeded as approved)
('core_principles','DI-01','Single source of truth','{"category":"data_integrity","description":"Every record has one owning module and one canonical copy; other modules link to it rather than copying it.","rationale":"Copies drift and reports stop agreeing."}','active','2026-01-01',null),
('core_principles','DI-02','Region and market kept separate','{"category":"data_integrity","description":"Region and market are recorded as separate fields on every operational record.","rationale":"Reporting must cut either way without parsing text."}','active','2026-01-01',null),
('core_principles','DI-03','Change by new version, not overwrite','{"category":"data_integrity","description":"Values that change from a date are superseded, keeping the old version for anything dated before.","rationale":"History must be reproducible."}','active','2026-01-01',null),
('core_principles','AC-01','Least privilege','{"category":"access_control","description":"People see and change only what their role needs. Vendors only ever see their own data.","rationale":"Protects clients, vendors and commercial terms."}','active','2026-01-01',null),
('core_principles','AC-02','No self-approval','{"category":"access_control","description":"Whoever makes a change or request cannot also approve it.","rationale":"Two people for every decision that matters."}','active','2026-01-01',null),
('core_principles','PR-01','Every decision is traceable','{"category":"provenance","description":"Who changed what, when and why is recorded automatically and cannot be edited.","rationale":"Audit readiness and trust."}','active','2026-01-01',null),
('core_principles','GO-01','Every rule has an owner','{"category":"governance_ownership","description":"Each library and threshold has a named owning module and governor.","rationale":"Someone is accountable for keeping it right."}','active','2026-01-01',null),
('core_principles','UX-01','Plain English, no jargon','{"category":"user_experience","description":"Screens and messages use conversational language and explain what to do next.","rationale":"People use what they understand."}','active','2026-01-01',null),
-- Delegation of authority (GBP)
('doa_levels','L0','Up to £5,000','{"approval_level":0,"max_approval_amount":5000,"currency":"GBP","role_titles":["All markets · Buyer"]}','active','2026-01-01',null),
('doa_levels','L1','Up to £25,000','{"approval_level":1,"max_approval_amount":25000,"currency":"GBP","role_titles":["All markets · Senior buyer"]}','active','2026-01-01',null),
('doa_levels','L2','Up to £50,000','{"approval_level":2,"max_approval_amount":50000,"currency":"GBP","role_titles":["Region · Sourcing lead"]}','active','2026-01-01',null),
('doa_levels','L3','Up to £100,000','{"approval_level":3,"max_approval_amount":100000,"currency":"GBP","role_titles":["Region · Procurement director"]}','active','2026-01-01',null),
('doa_levels','L4','Up to £250,000','{"approval_level":4,"max_approval_amount":250000,"currency":"GBP","role_titles":["Global · Chief Procurement Officer"]}','active','2026-01-01',null),
('doa_levels','L5','Uncapped','{"approval_level":5,"max_approval_amount":null,"currency":"GBP","role_titles":["Group · CFO"]}','active','2026-01-01',null),
-- Material emission factors (indicative)
('material_emission_factors','MEF-BOARD-V','Virgin folding boxboard','{"material_category":"board","factor_kgco2e_per_kg":1.05,"boundary":"cradle_to_gate","content_basis":"virgin","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"EU"}','active','2026-01-01',null),
('material_emission_factors','MEF-BOARD-R','Recycled board','{"material_category":"board","factor_kgco2e_per_kg":0.72,"boundary":"cradle_to_gate","content_basis":"recycled","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"EU"}','active','2026-01-01',null),
('material_emission_factors','MEF-CORR','Corrugated board','{"material_category":"corrugated","factor_kgco2e_per_kg":0.80,"boundary":"cradle_to_gate","content_basis":"mixed","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"EU"}','active','2026-01-01',null),
('material_emission_factors','MEF-PAPER','Coated paper','{"material_category":"paper","factor_kgco2e_per_kg":1.10,"boundary":"cradle_to_gate","content_basis":"virgin","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"EU"}','active','2026-01-01',null),
('material_emission_factors','MEF-PP','Polypropylene','{"material_category":"fluted_polypropylene","factor_kgco2e_per_kg":1.98,"boundary":"cradle_to_gate","content_basis":"virgin","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"Global"}','active','2026-01-01',null),
('material_emission_factors','MEF-PVC','PVC','{"material_category":"pvc_foam","factor_kgco2e_per_kg":2.40,"boundary":"cradle_to_gate","content_basis":"virgin","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"Global"}','active','2026-01-01',null),
('material_emission_factors','MEF-ACRYL','Acrylic (PMMA)','{"material_category":"acrylic","factor_kgco2e_per_kg":3.80,"boundary":"cradle_to_gate","content_basis":"virgin","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"Global"}','active','2026-01-01',null),
('material_emission_factors','MEF-WOOD','Plywood','{"material_category":"wood","factor_kgco2e_per_kg":0.68,"boundary":"cradle_to_gate","content_basis":"virgin","factor_set":"Demo set 2026","source":"Indicative","published_year":2025,"geography":"EU"}','active','2026-01-01',null),
-- Transport emission factors (indicative)
('transport_emission_factors','TEF-ROAD','Road, articulated HGV','{"transport_mode":"road","vehicle_class":"HGV >33t","factor_gco2e_per_tonne_km":88,"distance_correction_factor":1.05,"scope":"well_to_wheel","factor_set":"Demo set 2026","published_year":2025}','active','2026-01-01',null),
('transport_emission_factors','TEF-AIR','Air freight, long haul','{"transport_mode":"air","vehicle_class":"Freighter","factor_gco2e_per_tonne_km":1130,"distance_correction_factor":1.09,"scope":"well_to_wheel","factor_set":"Demo set 2026","published_year":2025}','active','2026-01-01',null),
('transport_emission_factors','TEF-SEA','Sea freight, container','{"transport_mode":"sea","vehicle_class":"Container ship","factor_gco2e_per_tonne_km":16,"distance_correction_factor":1.15,"scope":"well_to_wheel","factor_set":"Demo set 2026","published_year":2025}','active','2026-01-01',null),
('transport_emission_factors','TEF-RAIL','Rail freight','{"transport_mode":"rail","vehicle_class":"Electric/diesel mix","factor_gco2e_per_tonne_km":27,"distance_correction_factor":1.0,"scope":"well_to_wheel","factor_set":"Demo set 2026","published_year":2025}','active','2026-01-01',null),
('transport_emission_factors','TEF-COURIER','Courier van','{"transport_mode":"courier","vehicle_class":"Van <3.5t","factor_gco2e_per_tonne_km":580,"distance_correction_factor":1.1,"scope":"well_to_wheel","factor_set":"Demo set 2026","published_year":2025}','active','2026-01-01',null),
-- Impact Grade dimensions (weights total 100)
('impact_grade_dimensions','carbon_footprint','Carbon footprint','{"weight_percent":25,"source_description":"Substrate emission factors × weight, plus transport CO2e"}','active','2026-01-01',null),
('impact_grade_dimensions','recycled_content','Recycled content','{"weight_percent":15,"source_description":"Substrate recycled content %"}','active','2026-01-01',null),
('impact_grade_dimensions','end_of_life','End of life assured','{"weight_percent":15,"source_description":"Recyclability and take-back"}','active','2026-01-01',null),
('impact_grade_dimensions','environment_safe','Environment safe','{"weight_percent":10,"source_description":"Restricted substances and inks"}','active','2026-01-01',null),
('impact_grade_dimensions','supply_chain','Supply chain optimised','{"weight_percent":10,"source_description":"Local sourcing and consolidated freight"}','active','2026-01-01',null),
('impact_grade_dimensions','value_engineered','Value engineered','{"weight_percent":10,"source_description":"Material efficiency"}','active','2026-01-01',null),
('impact_grade_dimensions','design_for_reuse','Design for reuse','{"weight_percent":10,"source_description":"Modularity and reuse"}','active','2026-01-01',null),
('impact_grade_dimensions','recycle_ready','Recycle ready','{"weight_percent":5,"source_description":"Mono-material and easy separation"}','active','2026-01-01',null),
-- Certification types
('certification_types','ISO_9001','ISO 9001 Quality management','{"category":"quality","validity_months":36,"critical":true}','active','2026-01-01',null),
('certification_types','ISO_14001','ISO 14001 Environmental management','{"category":"environmental","validity_months":36,"critical":false}','active','2026-01-01',null),
('certification_types','ISO_45001','ISO 45001 Health and safety','{"category":"health_safety","validity_months":36,"critical":false}','active','2026-01-01',null),
('certification_types','FSC','FSC Chain of Custody','{"category":"environmental","validity_months":60,"critical":true}','active','2026-01-01',null),
('certification_types','PEFC','PEFC Chain of Custody','{"category":"environmental","validity_months":60,"critical":false}','active','2026-01-01',null),
('certification_types','SEDEX','Sedex / SMETA audit','{"category":"ethical","validity_months":24,"critical":true}','active','2026-01-01',null),
('certification_types','ECOVADIS','EcoVadis rating','{"category":"esg","validity_months":12,"critical":false}','active','2026-01-01',null),
('certification_types','BRCGS','BRCGS Packaging','{"category":"product","validity_months":12,"critical":false}','active','2026-01-01',null),
('certification_types','GRS','Global Recycled Standard','{"category":"environmental","validity_months":12,"critical":false}','active','2026-01-01',null),
('certification_types','OEKO_TEX','OEKO-TEX Standard 100','{"category":"product","validity_months":12,"critical":false}','active','2026-01-01',null),
-- Control document types
('order_document_types','GRN','Goods received note','{"required_for_categories":["print","packaging","POS","merchandise"],"uploaded_by":"either"}','active','2026-01-01',null),
('order_document_types','BOL','Bill of lading','{"required_for_categories":["packaging","logistics"],"uploaded_by":"vendor"}','active','2026-01-01',null),
('order_document_types','INVOICE','Supplier invoice','{"required_for_categories":["print","packaging","POS","digital","logistics","merchandise","creative"],"uploaded_by":"vendor"}','active','2026-01-01',null),
('order_document_types','DELIVERY_NOTE','Delivery note','{"required_for_categories":["print","POS"],"uploaded_by":"vendor"}','active','2026-01-01',null),
('order_document_types','CUSTOMS','Customs declaration','{"required_for_categories":["logistics"],"uploaded_by":"vendor"}','active','2026-01-01',null),
('order_document_types','QUALITY_CERT','Quality certificate','{"required_for_categories":["packaging","merchandise"],"uploaded_by":"vendor"}','active','2026-01-01',null),
('order_document_types','PACKING_LIST','Packing list','{"required_for_categories":[],"uploaded_by":"vendor"}','active','2026-01-01',null),
('order_document_types','POD','Proof of delivery','{"required_for_categories":[],"uploaded_by":"vendor"}','active','2026-01-01',null),
-- Non-conformance categories
('ncr_categories','NCR-PRINT','Print quality','{"severity":"medium","description":"Colour, registration or finish outside tolerance"}','active','2026-01-01',null),
('ncr_categories','NCR-DIM','Dimensions out of tolerance','{"severity":"high","description":"Finished size or fit wrong"}','active','2026-01-01',null),
('ncr_categories','NCR-MAT','Wrong material or substitution','{"severity":"critical","description":"Material differs from the approved spec"}','active','2026-01-01',null),
('ncr_categories','NCR-PACK','Packing failure','{"severity":"medium","description":"Packing not to spec, damage risk"}','active','2026-01-01',null),
('ncr_categories','NCR-LATE','Late delivery','{"severity":"medium","description":"Missed agreed delivery date"}','active','2026-01-01',null),
('ncr_categories','NCR-DAMAGE','Damaged on arrival','{"severity":"high","description":"Goods damaged in transit or handling"}','active','2026-01-01',null),
('ncr_categories','NCR-DOC','Missing documents','{"severity":"low","description":"Required control documents missing"}','active','2026-01-01',null),
-- Sourcing control matrix (white paper)
('sourcing_control_matrix','SCM-1','Under €5k','{"min_value_eur":0,"max_value_eur":4999.99,"suppliers_in_country":3,"suppliers_cross_border":0,"strategy_owner":"Defined panels / Production services","external_price_validation":"No","e_sourcing":false}','active','2026-01-01',null),
('sourcing_control_matrix','SCM-2','€5k to €25k','{"min_value_eur":5000,"max_value_eur":24999.99,"suppliers_in_country":3,"suppliers_cross_border":2,"strategy_owner":"Defined panels / CM team · PC lead","external_price_validation":"1 in 25","e_sourcing":false}','active','2026-01-01',null),
('sourcing_control_matrix','SCM-3','€25k to €50k','{"min_value_eur":25000,"max_value_eur":49999.99,"suppliers_in_country":3,"suppliers_cross_border":2,"strategy_owner":"BD / PC lead / CM","external_price_validation":"1 in 10","e_sourcing":false}','active','2026-01-01',null),
('sourcing_control_matrix','SCM-4','€50k to €100k','{"min_value_eur":50000,"max_value_eur":99999.99,"suppliers_in_country":3,"suppliers_cross_border":2,"strategy_owner":"Bespoke strategy · BD / PC lead / CM","external_price_validation":"1 in 3","e_sourcing":true}','active','2026-01-01',null),
('sourcing_control_matrix','SCM-5','€100k and over','{"min_value_eur":100000,"max_value_eur":null,"suppliers_in_country":5,"suppliers_cross_border":3,"strategy_owner":"Bespoke sourcing · P&SC DRT","external_price_validation":"Every job","e_sourcing":true}','active','2026-01-01',null),
('bypass_reasons','BYP-RATE','Live rate card applies','{"description":"Exact match to an approved rate card (Adopt)","needs_approval":false}','active','2026-01-01',null),
('bypass_reasons','BYP-SOLE','Sole supplier / proprietary','{"description":"Only one qualified supplier can make it","needs_approval":true}','active','2026-01-01',null),
('bypass_reasons','BYP-CLIENT','Client-nominated supplier','{"description":"Client contract names the supplier","needs_approval":true}','active','2026-01-01',null),
('bypass_reasons','BYP-URGENT','Genuine emergency','{"description":"Time-critical; documented and reviewed after","needs_approval":true}','active','2026-01-01',null),
-- Logistics
('carriers','CAR-DHL','DHL Express','{"modes":["courier","air"],"regions":["EMEA","APAC","Americas"],"tracking_url":"https://www.dhl.com"}','active','2026-01-01',null),
('carriers','CAR-UPS','UPS','{"modes":["courier","road"],"regions":["EMEA","Americas"]}','active','2026-01-01',null),
('carriers','CAR-MAERSK','Maersk','{"modes":["sea"],"regions":["Global"]}','active','2026-01-01',null),
('pod_checklist','POD-1','Job number','{"guidance":"Our job number shown on the POD","mandatory":true}','active','2026-01-01',null),
('pod_checklist','POD-2','PO number','{"guidance":"Supplier PO number shown","mandatory":true}','active','2026-01-01',null),
('pod_checklist','POD-3','Quantity delivered','{"guidance":"Quantity matches the delivery","mandatory":true}','active','2026-01-01',null),
('pod_checklist','POD-4','Description of goods','{"guidance":"Goods described","mandatory":true}','active','2026-01-01',null),
('pod_checklist','POD-5','Delivery address and contact','{"guidance":"Matches the planned destination","mandatory":true}','active','2026-01-01',null),
('pod_checklist','POD-6','Packing information','{"guidance":"Cartons/pallets recorded","mandatory":false}','active','2026-01-01',null),
('pod_checklist','POD-7','Signature or stamp','{"guidance":"Receiver signed or stamped","mandatory":true}','active','2026-01-01',null),
('pod_checklist','POD-8','Date of delivery','{"guidance":"Delivery date recorded","mandatory":true}','active','2026-01-01',null),
-- Execution
('display_scoring','DS-PLACE','Placement','{"weight_percent":30,"guidance":"In the agreed location and facing"}','active','2026-01-01',null),
('display_scoring','DS-COND','Condition','{"weight_percent":25,"guidance":"Undamaged, clean, complete"}','active','2026-01-01',null),
('display_scoring','DS-STOCK','Stocked','{"weight_percent":25,"guidance":"Product present and full"}','active','2026-01-01',null),
('display_scoring','DS-COMMS','Communication','{"weight_percent":20,"guidance":"Correct messaging and pricing shown"}','active','2026-01-01',null),
-- Shopper IQ
('touchpoint_types','TP-DISPLAY','Display','{"permanence":"temporary"}','active','2026-01-01',null),
('touchpoint_types','TP-DUMPBIN','Dumpbin','{"permanence":"temporary"}','active','2026-01-01',null),
('touchpoint_types','TP-FSU','Floor-standing unit','{"permanence":"temporary"}','active','2026-01-01',null),
('touchpoint_types','TP-GWP','Gift with purchase','{"permanence":"temporary"}','active','2026-01-01',null),
('touchpoint_types','TP-HANGSELL','Hang-sell','{"permanence":"temporary"}','active','2026-01-01',null),
('touchpoint_types','TP-HEADER','Header','{"permanence":"temporary"}','active','2026-01-01',null),
('touchpoint_types','TP-POSTER','Poster','{"permanence":"temporary"}','active','2026-01-01',null),
('touchpoint_types','TP-SHELF','Shelf talker','{"permanence":"temporary"}','active','2026-01-01',null),
('p2p_stages','P2P-CONNECT','Connect','{"framework":"connect_engage_sell","order":1}','active','2026-01-01',null),
('p2p_stages','P2P-ENGAGE','Engage','{"framework":"connect_engage_sell","order":2}','active','2026-01-01',null),
('p2p_stages','P2P-SELL','Sell','{"framework":"connect_engage_sell","order":3}','active','2026-01-01',null),
('p2p_stages','P2P-GUIDE','Guide','{"framework":"connect_guide_convert","order":2}','active','2026-01-01',null),
('p2p_stages','P2P-CONVERT','Convert','{"framework":"connect_guide_convert","order":3}','active','2026-01-01',null),
-- Briefing field library
('brief_fields','BF-QTY','Quantity','{"drives":"price","required":true}','active','2026-01-01',null),
('brief_fields','BF-TIMING','In-store date','{"drives":"timing","required":true}','active','2026-01-01',null),
('brief_fields','BF-FORMAT','Store format','{"drives":"price","required":true}','active','2026-01-01',null),
('brief_fields','BF-BUDGET','Budget range','{"drives":"price","required":false}','active','2026-01-01',null),
('brief_fields','BF-AQL','Test standard / AQL','{"drives":"quality","required":false}','active','2026-01-01',null),
('brief_fields','BF-CERT','Certification needed','{"drives":"compliance","required":false}','active','2026-01-01',null),
('brief_fields','BF-ENDUSE','End-use environment','{"drives":"quality","required":false}','active','2026-01-01',null);

-- Substrates (link to material factors by code)
insert into public.library_records (library_key, code, name, data, status, effective_from) values
('substrates','SUB-FBB350','Folding boxboard 350gsm','{"substrate_type":"board","measurement_basis":"grammage","grammage_gsm":350,"recycled_content_percent":0,"fsc_certified":true,"verification_status":"supplier_confirmed","virgin_factor_code":"MEF-BOARD-V","recycled_factor_code":"MEF-BOARD-R"}','active','2026-01-01'),
('substrates','SUB-SBS300','Solid bleached board 300gsm','{"substrate_type":"board","measurement_basis":"grammage","grammage_gsm":300,"recycled_content_percent":0,"fsc_certified":true,"verification_status":"indicative","virgin_factor_code":"MEF-BOARD-V"}','active','2026-01-01'),
('substrates','SUB-CORR-BC','Corrugated BC flute','{"substrate_type":"corrugated","measurement_basis":"grammage","grammage_gsm":700,"recycled_content_percent":80,"fsc_certified":true,"verification_status":"measured","virgin_factor_code":"MEF-CORR"}','active','2026-01-01'),
('substrates','SUB-PP-FLUTE','Fluted polypropylene 5mm','{"substrate_type":"fluted_polypropylene","measurement_basis":"thickness_density","thickness_mm":5,"density_kg_per_m3":180,"recycled_content_percent":0,"fsc_certified":false,"verification_status":"indicative","virgin_factor_code":"MEF-PP"}','active','2026-01-01'),
('substrates','SUB-PVCFOAM5','PVC foam board 5mm','{"substrate_type":"pvc_foam","measurement_basis":"thickness_density","thickness_mm":5,"density_kg_per_m3":500,"recycled_content_percent":0,"fsc_certified":false,"verification_status":"indicative","virgin_factor_code":"MEF-PVC"}','active','2026-01-01'),
('substrates','SUB-ACRYL3','Acrylic sheet 3mm','{"substrate_type":"acrylic","measurement_basis":"thickness_density","thickness_mm":3,"density_kg_per_m3":1190,"recycled_content_percent":0,"fsc_certified":false,"verification_status":"supplier_confirmed","virgin_factor_code":"MEF-ACRYL"}','active','2026-01-01'),
('substrates','SUB-VINYL','Self-adhesive vinyl','{"substrate_type":"vinyl","measurement_basis":"grammage","grammage_gsm":180,"recycled_content_percent":0,"fsc_certified":false,"verification_status":"indicative"}','active','2026-01-01'),
('substrates','SUB-KRAFT120','Kraft paper 120gsm','{"substrate_type":"paper","measurement_basis":"grammage","grammage_gsm":120,"recycled_content_percent":100,"fsc_certified":true,"verification_status":"supplier_confirmed","recycled_factor_code":"MEF-PAPER"}','active','2026-01-01'),
('substrates','SUB-POLYTEX','Polyester fabric','{"substrate_type":"textile","measurement_basis":"grammage","grammage_gsm":220,"recycled_content_percent":50,"fsc_certified":false,"verification_status":"indicative"}','active','2026-01-01'),
('substrates','SUB-PINEPLY','Pine plywood 12mm','{"substrate_type":"wood","measurement_basis":"thickness_density","thickness_mm":12,"density_kg_per_m3":520,"recycled_content_percent":0,"fsc_certified":true,"verification_status":"indicative","virgin_factor_code":"MEF-WOOD"}','active','2026-01-01');

-- A logged change request so the queue isn't empty.
insert into public.change_requests (module, source_area, request_text, category, requester_type)
values ('watchtower', '/watchtower/libraries/substrates', 'Show the blended emission factor next to each substrate so buyers can compare options at a glance.', 'user_experience', 'internal');
insert into public.change_request_events (change_request_id, to_status)
select id, 'logged' from public.change_requests where request_no = 1;
