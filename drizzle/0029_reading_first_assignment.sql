-- Append-only owner-approved first assignment. No session flag or trigger bypass.
CREATE TABLE reading_configuration_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, store_id uuid NOT NULL,
 unit_id uuid NOT NULL, product_version_id uuid NOT NULL, actor_id text NOT NULL REFERENCES app_users(id),
 command_id uuid NOT NULL, expected_revision integer NOT NULL CONSTRAINT assignment_revision CHECK(expected_revision>=0),
 source_evidence jsonb NOT NULL CONSTRAINT assignment_evidence CHECK(jsonb_typeof(source_evidence)='object' AND octet_length(source_evidence::text)<=262144),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT assignment_unit_unique UNIQUE(organization_id,store_id,unit_id),
 CONSTRAINT assignment_command_unique UNIQUE(organization_id,store_id,command_id),
 FOREIGN KEY(organization_id,store_id,unit_id) REFERENCES fulfillment_units(organization_id,store_id,id),
 FOREIGN KEY(organization_id,store_id,product_version_id) REFERENCES product_versions(organization_id,store_id,id)
);
--> statement-breakpoint
-- Validate identities and canonicalize only IDs; labels and SKU never authorize a binding.
CREATE FUNCTION recovery_selection_key(rows jsonb, purchased boolean) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text; r jsonb; vals jsonb; parts text[] := ARRAY[]::text[]; properties text[] := ARRAY[]::text[]; property text; values_text text;
BEGIN
 IF jsonb_typeof(rows) IS DISTINCT FROM 'array' OR jsonb_array_length(rows)>3 THEN RAISE EXCEPTION 'RECOVERY_OPTIONS_REQUIRED'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(rows) LOOP
  property:=r->>'propertyId';
  vals:=CASE WHEN purchased THEN r#>'{valueIds,value}' ELSE r->'valueIds' END;
  IF property IS NULL OR property !~ '^[1-9][0-9]{0,19}$' OR property=ANY(properties)
   OR (purchased AND r#>>'{valueIds,presence}' IS DISTINCT FROM 'value')
   OR jsonb_typeof(vals) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'RECOVERY_OPTIONS_REQUIRED'; END IF;
  IF jsonb_array_length(vals) NOT BETWEEN 1 AND 30 OR EXISTS(SELECT 1 FROM jsonb_array_elements(vals) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR v#>>'{}' !~ '^[1-9][0-9]{0,19}$')
   OR (SELECT count(*)<>count(DISTINCT v) FROM jsonb_array_elements(vals) v) THEN RAISE EXCEPTION 'RECOVERY_OPTIONS_REQUIRED'; END IF;
  SELECT string_agg(v,',' ORDER BY v COLLATE "C") INTO values_text FROM jsonb_array_elements_text(vals) v;
  parts:=array_append(parts,property||'='||values_text);properties:=array_append(properties,property);
 END LOOP;
 SELECT string_agg(v,';' ORDER BY v COLLATE "C") INTO result FROM unnest(parts) v;
 RETURN 'etsy-selection/1:'||coalesce(result,'');
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_reading_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u fulfillment_units%ROWTYPE; l order_line_items%ROWTYPE; o orders%ROWTYPE; s stores%ROWTYPE; v product_versions%ROWTYPE; source jsonb; policy jsonb; key text; p jsonb; selected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ASSIGNMENT_IMMUTABLE'; END IF;
 SELECT * INTO s FROM stores WHERE organization_id=NEW.organization_id AND id=NEW.store_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM memberships WHERE organization_id=NEW.organization_id AND user_id=NEW.actor_id AND role='owner') THEN RAISE EXCEPTION 'RECOVERY_OWNER_REQUIRED'; END IF;
 SELECT * INTO u FROM fulfillment_units WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND id=NEW.unit_id FOR UPDATE;
 IF NOT FOUND OR u.configuration_state<>'unconfigured' OR u.product_version_id IS NOT NULL THEN RAISE EXCEPTION 'ASSIGNMENT_CONFLICT'; END IF;
 IF u.revision<>NEW.expected_revision OR u.source_changed THEN RAISE EXCEPTION 'RECOVERY_SOURCE_CHANGED'; END IF;
 SELECT * INTO l FROM order_line_items WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND id=u.line_item_id FOR UPDATE;
 SELECT * INTO o FROM orders WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND id=l.order_id FOR UPDATE;
 source:=l.snapshot->'etsySource';
 IF source IS NULL OR NEW.source_evidence IS DISTINCT FROM source OR source->>'contractVersion' IS DISTINCT FROM 'etsy-purchased-line/v1'
  OR source#>>'{receipt,shopId}' IS DISTINCT FROM s.external_shop_id OR source#>>'{receipt,receiptId}' IS DISTINCT FROM o.external_id
  OR source#>>'{transaction,transactionId}' IS DISTINCT FROM l.external_id OR source#>>'{transaction,listingId,presence}' IS DISTINCT FROM 'value'
  OR source#>>'{transaction,listingId,value}' IS DISTINCT FROM l.listing_external_id OR source#>>'{transaction,quantity}' IS DISTINCT FROM l.quantity::text
  OR u.unit_index NOT BETWEEN 1 AND l.quantity OR source#>>'{receipt,createdTimestamp,presence}' IS DISTINCT FROM 'value'
  OR coalesce(source#>>'{receipt,createdTimestamp,value}','') !~ '^[0-9]{1,16}$'
  OR source#>>'{transaction,isDigital,presence}' IS DISTINCT FROM 'value'
  OR source#>>'{receipt,isPaid,value}' IS DISTINCT FROM 'true' OR source#>>'{receipt,cancellation,state}' IS DISTINCT FROM 'NOT_CANCELED'
  OR source#>>'{receipt,refundAssessment}' IS DISTINCT FROM 'NONE_REPORTED'
  OR lower(coalesce(source#>>'{receipt,status,value}','')) NOT IN ('paid','completed')
  OR source#>>'{receipt,refunds,presence}' IS DISTINCT FROM 'value' OR source#>'{receipt,refunds,value}' IS DISTINCT FROM '[]'::jsonb
  OR NOT o.paid OR o.canceled OR o.refund<>'none' THEN RAISE EXCEPTION 'RECOVERY_EVIDENCE_REQUIRED'; END IF;
 SELECT * INTO v FROM product_versions WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND id=NEW.product_version_id;
 IF NOT FOUND OR v.status NOT IN ('ACTIVE','ARCHIVED') OR v.activated_at IS NULL THEN RAISE EXCEPTION 'RECOVERY_VERSION_REQUIRED'; END IF;
 policy:=v.configuration->'etsyFulfillment';
 IF policy->>'contractVersion' IS DISTINCT FROM 'etsy-product-policy/v1' OR policy->>'fulfillment' IS DISTINCT FROM 'READING'
  OR policy->>'listingId' IS DISTINCT FROM l.listing_external_id THEN RAISE EXCEPTION 'RECOVERY_LISTING_MISMATCH'; END IF;
 key:=recovery_selection_key(source->'purchaseSelections',true);
 IF key<>l.variant_key OR key<>recovery_selection_key(policy->'purchaseSelections',false) THEN RAISE EXCEPTION 'RECOVERY_OPTIONS_MISMATCH'; END IF;
 -- Corroborating purchased product data may only confirm the exact saved option IDs.
 IF source#>>'{purchaseProductData,presence}'='value' THEN
  IF jsonb_typeof(source#>'{purchaseProductData,value}') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(source#>'{purchaseProductData,value}') x GROUP BY x#>>'{propertyId,value}' HAVING count(*)>1) THEN RAISE EXCEPTION 'RECOVERY_OPTIONS_REQUIRED'; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(source#>'{purchaseProductData,value}') LOOP
   SELECT value INTO selected FROM jsonb_array_elements(source->'purchaseSelections') x WHERE x->>'propertyId'=p#>>'{propertyId,value}';
   IF selected IS NULL OR p#>>'{propertyId,presence}' IS DISTINCT FROM 'value'
    OR p#>>'{scaleId,presence}'='value' OR p#>>'{scaleName,presence}'='value'
    OR recovery_selection_key(jsonb_build_array(selected),true)<>recovery_selection_key(jsonb_build_array(jsonb_build_object('propertyId',p#>>'{propertyId,value}','valueIds',p->'valueIds')),true)
   THEN RAISE EXCEPTION 'RECOVERY_OPTIONS_REQUIRED'; END IF;
  END LOOP;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM listing_mappings WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND product_id=v.product_id AND listing_external_id=l.listing_external_id AND variant_key=key AND NOT paused) THEN RAISE EXCEPTION 'RECOVERY_MAPPING_REQUIRED'; END IF;
 IF jsonb_typeof(source->'unsupported') IS DISTINCT FROM 'array' OR jsonb_array_length(source->'unsupported')<>0
  OR jsonb_typeof(source->'buyerFiles') IS DISTINCT FROM 'array' OR jsonb_array_length(source->'buyerFiles')<>0
  OR jsonb_typeof(source->'buyerInputs') IS DISTINCT FROM 'array' OR jsonb_typeof(policy->'inputMappings') IS DISTINCT FROM 'array'
  OR jsonb_array_length(policy->'inputMappings')>5
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'inputMappings') m GROUP BY m->>'questionId' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'inputMappings') m GROUP BY m->>'inputKey' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'inputMappings') m WHERE coalesce(m->>'questionId','') !~ '^[1-9][0-9]{0,19}$' OR m->>'propertyId' IS DISTINCT FROM '54' OR m->>'sourceType' IS DISTINCT FROM 'text_input'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.configuration->'inputs') f WHERE f->>'key'=m->>'inputKey'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(source->'buyerInputs') i GROUP BY i#>>'{questionId,value}' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(source->'buyerInputs') i WHERE i->>'encoding' IS DISTINCT FROM 'TEXT'
    OR i#>>'{propertyId,value}' IS DISTINCT FROM '54' OR i#>>'{questionId,presence}' IS DISTINCT FROM 'value'
    OR i#>>'{valueId,presence}'='value'
    OR (i#>>'{sourceType,presence}'='value' AND i#>>'{sourceType,value}' IS DISTINCT FROM 'text_input')
    OR (i#>>'{definition,questionId,presence}'='value' AND i#>>'{definition,questionId,value}' IS DISTINCT FROM i#>>'{questionId,value}')
    OR (i#>>'{definition,questionType,presence}'='value' AND i#>>'{definition,questionType,value}' IS DISTINCT FROM 'text_input')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'inputMappings') m WHERE m->>'questionId'=i#>>'{questionId,value}' AND m->>'propertyId'='54' AND m->>'sourceType'='text_input'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.configuration->'inputs') f WHERE f->>'key'=m->>'inputKey')))
 THEN RAISE EXCEPTION 'RECOVERY_INPUT_MAPPING_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM generations WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND unit_id=u.id)
  OR EXISTS(SELECT 1 FROM production_queue WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND unit_id=u.id) THEN RAISE EXCEPTION 'RECOVERY_EXISTING_WORK'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reading_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON reading_configuration_assignments FOR EACH ROW EXECUTE FUNCTION guard_reading_assignment();
--> statement-breakpoint
CREATE FUNCTION apply_reading_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE fulfillment_units SET product_version_id=NEW.product_version_id,configuration_state='versioned'
 WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND id=NEW.unit_id AND product_version_id IS NULL AND configuration_state='unconfigured';
 IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_CONFLICT'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reading_assignment_apply AFTER INSERT ON reading_configuration_assignments FOR EACH ROW EXECUTE FUNCTION apply_reading_assignment();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_unit_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.product_version_id IS DISTINCT FROM NEW.product_version_id OR OLD.configuration_state<>NEW.configuration_state) THEN
  IF OLD.product_version_id IS NOT NULL OR OLD.configuration_state<>'unconfigured' OR NEW.product_version_id IS NULL OR NEW.configuration_state<>'versioned'
   OR (to_jsonb(OLD)-'product_version_id'-'configuration_state') IS DISTINCT FROM (to_jsonb(NEW)-'product_version_id'-'configuration_state')
   OR NOT EXISTS(SELECT 1 FROM reading_configuration_assignments a WHERE a.organization_id=OLD.organization_id AND a.store_id=OLD.store_id AND a.unit_id=OLD.id AND a.product_version_id=NEW.product_version_id AND a.expected_revision=OLD.revision)
  THEN RAISE EXCEPTION 'UNIT_CONFIGURATION_IMMUTABLE'; END IF;
 END IF;
 IF TG_OP='INSERT' AND NEW.product_version_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM product_versions v WHERE v.id=NEW.product_version_id AND v.organization_id=NEW.organization_id AND v.store_id=NEW.store_id
   AND (v.status='ACTIVE' OR (v.status='ARCHIVED' AND EXISTS(
    SELECT 1 FROM etsy_historical_adoptions a JOIN order_line_items l ON l.id=NEW.line_item_id AND l.organization_id=a.organization_id AND l.store_id=a.store_id
     JOIN orders o ON o.id=l.order_id AND o.organization_id=a.organization_id AND o.store_id=a.store_id
    WHERE a.organization_id=NEW.organization_id AND a.store_id=NEW.store_id AND a.product_version_id=v.id
     AND a.receipt_id=o.external_id AND a.transaction_id=l.external_id AND a.listing_id=l.listing_external_id AND a.selection_key=l.variant_key
     AND a.shop_id=l.snapshot#>>'{etsySource,receipt,shopId}' AND a.source_fingerprint IS NOT NULL
     AND (l.snapshot#>>'{etsySource,receipt,createdTimestamp,value}')::bigint BETWEEN a.purchase_from AND a.purchase_through
   )))
 ) THEN RAISE EXCEPTION 'ACTIVE_CONFIGURATION_REQUIRED'; END IF;
 RETURN NEW;
END $$;
