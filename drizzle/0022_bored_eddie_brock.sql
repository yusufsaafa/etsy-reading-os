ALTER TABLE "generations" ALTER COLUMN "style_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "seller_profile_id" DROP NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u fulfillment_units%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO u FROM fulfillment_units WHERE id=NEW.unit_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id;
  IF u.product_version_id IS DISTINCT FROM NEW.product_version_id OR NEW.context->>'unitId' IS DISTINCT FROM NEW.unit_id::text OR NEW.context#>>'{product,id}' IS DISTINCT FROM NEW.product_version_id::text  OR (NEW.context#>>'{customer,revision}')::integer IS DISTINCT FROM NEW.customer_revision THEN RAISE EXCEPTION 'GENERATION_BINDING_INVALID'; END IF;
  IF NEW.style_version_id IS NOT NULL THEN
   IF NEW.context#>>'{style,id}' IS DISTINCT FROM NEW.style_version_id::text THEN RAISE EXCEPTION 'GENERATION_BINDING_INVALID'; END IF;
  ELSIF NEW.context#>>'{style,id}' IS DISTINCT FROM 'reading-os-default-style/v1'
    OR NEW.context#>>'{style,versionNumber}' IS DISTINCT FROM '1'
    OR NEW.context->>'outputLanguage' IS DISTINCT FROM 'en'
    OR COALESCE(NEW.context#>>'{styleResolution,source}','') NOT IN ('PLATFORM_DEFAULT','SELLER_STYLE_INTELLIGENCE') THEN
    RAISE EXCEPTION 'GENERATION_DEFAULT_STYLE_INVALID';
  END IF;
  IF NEW.seller_profile_id IS NOT NULL THEN
   IF NEW.context#>>'{seller,id}' IS DISTINCT FROM NEW.seller_profile_id::text THEN RAISE EXCEPTION 'GENERATION_BINDING_INVALID'; END IF;
  ELSIF NEW.context#>>'{seller,id}' IS DISTINCT FROM NEW.store_id::text
    OR NEW.context#>>'{seller,source}' IS DISTINCT FROM 'STORE' THEN
    RAISE EXCEPTION 'GENERATION_DEFAULT_IDENTITY_INVALID';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GENERATION_HISTORY_IMMUTABLE'; END IF;
 IF ROW(OLD.id,OLD.organization_id,OLD.store_id,OLD.unit_id,OLD.product_version_id,OLD.style_version_id,OLD.seller_profile_id,OLD.customer_revision,OLD.context,OLD.context_hash,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.store_id,NEW.unit_id,NEW.product_version_id,NEW.style_version_id,NEW.seller_profile_id,NEW.customer_revision,NEW.context,NEW.context_hash,NEW.created_at) OR OLD.status='SUCCEEDED' THEN RAISE EXCEPTION 'GENERATION_HISTORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
