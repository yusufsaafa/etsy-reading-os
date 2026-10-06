CREATE TABLE "platform_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "platform_assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "platform_asset_metadata" CHECK (jsonb_typeof("platform_assets"."metadata")='object' and octet_length("platform_assets"."metadata"::text)<=8192 and "platform_assets"."metadata"->>'id'="platform_assets"."id"::text and "platform_assets"."metadata"->>'objectKey'="platform_assets"."object_key")
);
--> statement-breakpoint
CREATE TABLE "store_tarot_preferences" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"deck_key" text NOT NULL,
	"deck_version" integer NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "store_tarot_preference_identity" UNIQUE("organization_id","store_id"),
	CONSTRAINT "tarot_preference_revision" CHECK ("store_tarot_preferences"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "tarot_deck_versions" (
	"deck_key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"manifest" jsonb NOT NULL,
	CONSTRAINT "tarot_deck_version_identity" UNIQUE("deck_key","version"),
	CONSTRAINT "tarot_version_bounds" CHECK ("tarot_deck_versions"."version">0 and "tarot_deck_versions"."status" in ('DRAFT','PUBLISHED','RETIRED') and jsonb_typeof("tarot_deck_versions"."manifest")='object' and octet_length("tarot_deck_versions"."manifest"::text)<=20000 and "tarot_deck_versions"."manifest"->>'deckKey'="tarot_deck_versions"."deck_key" and ("tarot_deck_versions"."manifest"->>'version')::integer="tarot_deck_versions"."version" and "tarot_deck_versions"."manifest"->>'status'="tarot_deck_versions"."status")
);
--> statement-breakpoint
CREATE TABLE "tarot_decks" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "tarot_deck_bounds" CHECK ("tarot_decks"."key" ~ '^[a-z][a-z0-9-]{0,63}$' and length(trim("tarot_decks"."name")) between 1 and 100 and length("tarot_decks"."description")<=300)
);
--> statement-breakpoint
ALTER TABLE "store_tarot_preferences" ADD CONSTRAINT "tarot_preference_owned_store" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_tarot_preferences" ADD CONSTRAINT "tarot_preference_exact_version" FOREIGN KEY ("deck_key","deck_version") REFERENCES "public"."tarot_deck_versions"("deck_key","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarot_deck_versions" ADD CONSTRAINT "tarot_deck_versions_deck_key_tarot_decks_key_fk" FOREIGN KEY ("deck_key") REFERENCES "public"."tarot_decks"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tarot_one_selectable_version" ON "tarot_deck_versions" USING btree ("deck_key") WHERE "tarot_deck_versions"."status"='PUBLISHED';
--> statement-breakpoint
CREATE FUNCTION validate_media_rights(v jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR
 (SELECT count(*) FROM jsonb_object_keys(v))<>5 OR
 NOT (v ?& ARRAY['state','classification','source','evidenceReference','notes']) OR
 jsonb_typeof(v->'state') IS DISTINCT FROM 'string' OR v->>'state' NOT IN ('UNVERIFIED','APPROVED','RESTRICTED') OR
 jsonb_typeof(v->'classification') IS DISTINCT FROM 'string' OR v->>'classification' NOT IN ('UNVERIFIED','PLATFORM_ORIGINAL','LICENSED','PUBLIC_DOMAIN') OR
 jsonb_typeof(v->'source') IS DISTINCT FROM 'string' OR length(v->>'source') NOT BETWEEN 1 AND 200 OR trim(v->>'source')<>v->>'source' OR v->>'source' ~ '[<>[:cntrl:]]' OR
 jsonb_typeof(v->'notes') IS DISTINCT FROM 'string' OR length(v->>'notes')>2000 OR
 jsonb_typeof(v->'evidenceReference') NOT IN ('string','null') OR
 (jsonb_typeof(v->'evidenceReference')='string' AND (length(v->>'evidenceReference') NOT BETWEEN 1 AND 300 OR trim(v->>'evidenceReference')<>v->>'evidenceReference' OR v->>'evidenceReference' ~ '[<>[:cntrl:]]')) OR
 (v->>'state'='APPROVED' AND (v->>'classification'='UNVERIFIED' OR nullif(v->>'evidenceReference','') IS NULL)) THEN
 RAISE EXCEPTION 'Invalid media rights'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION protect_platform_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Platform asset is immutable; create a new asset identity/object'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(NEW.metadata))<>11 OR
 EXISTS (SELECT 1 FROM unnest(ARRAY['id','kind','objectKey','mediaType','contentHash','status','createdAt']) k WHERE jsonb_typeof(NEW.metadata->k) IS DISTINCT FROM 'string') OR
 EXISTS (SELECT 1 FROM unnest(ARRAY['byteSize','width','height']) k WHERE jsonb_typeof(NEW.metadata->k) IS DISTINCT FROM 'number') OR
 NEW.metadata->>'id' IS DISTINCT FROM NEW.id::text OR NEW.metadata->>'objectKey' IS DISTINCT FROM NEW.object_key OR
 NEW.metadata->>'kind' IS DISTINCT FROM 'TAROT_CARD_IMAGE' OR
 NEW.object_key !~ '^platform/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$' OR NEW.object_key LIKE '%//%' OR
 NEW.metadata->>'mediaType' NOT IN ('image/png','image/jpeg','image/webp') OR
 NEW.metadata->>'contentHash' !~ '^[a-f0-9]{64}$' OR
 (NEW.metadata->>'byteSize')::bigint NOT BETWEEN 1 AND 26214400 OR
 (NEW.metadata->>'width')::integer NOT BETWEEN 1 AND 16384 OR (NEW.metadata->>'height')::integer NOT BETWEEN 1 AND 16384 OR
 (NEW.metadata->>'width')::bigint*(NEW.metadata->>'height')::bigint>100000000 OR
 (NEW.metadata->>'width')::numeric/(NEW.metadata->>'height')::numeric NOT BETWEEN 0.1 AND 10 OR
 length(NEW.object_key)>512 OR
 NEW.metadata->>'status' NOT IN ('READY','UNAVAILABLE') OR
 NEW.metadata->'rights'->>'state' NOT IN ('UNVERIFIED','APPROVED','RESTRICTED') OR
 NOT (NEW.metadata ?& ARRAY['id','kind','objectKey','mediaType','contentHash','byteSize','width','height','status','rights','createdAt']) THEN
 RAISE EXCEPTION 'Invalid platform asset'; END IF;
 PERFORM validate_media_rights(NEW.metadata->'rights');
 PERFORM (NEW.metadata->>'createdAt')::timestamptz;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER platform_asset_guard BEFORE INSERT OR UPDATE OR DELETE ON platform_assets FOR EACH ROW EXECUTE FUNCTION protect_platform_asset();
--> statement-breakpoint
CREATE FUNCTION validate_tarot_manifest(manifest jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE mapping jsonb; a platform_assets%ROWTYPE; keys text[];
BEGIN
 PERFORM validate_media_rights(manifest->'rights');
 PERFORM (manifest->>'createdAt')::timestamptz;
 IF (SELECT count(*) FROM jsonb_object_keys(manifest))<>7 OR
 NOT (manifest ?& ARRAY['deckKey','version','status','rights','mappings','mappingHash','createdAt']) OR
 jsonb_typeof(manifest->'createdAt') IS DISTINCT FROM 'string' OR
 manifest->'rights'->>'state' IS DISTINCT FROM 'APPROVED' OR
 manifest->'rights'->>'classification' NOT IN ('PLATFORM_ORIGINAL','LICENSED','PUBLIC_DOMAIN') OR
 nullif(manifest->'rights'->>'evidenceReference','') IS NULL OR
 jsonb_typeof(manifest->'mappings') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'mappings')<>78 OR
 manifest->>'mappingHash' IS NULL OR manifest->>'mappingHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Unusable tarot version'; END IF;
 SELECT array_agg(m->>'cardKey' ORDER BY m->>'cardKey') INTO keys FROM jsonb_array_elements(manifest->'mappings') m;
 IF keys IS DISTINCT FROM ARRAY['ACE_OF_CUPS','ACE_OF_PENTACLES','ACE_OF_SWORDS','ACE_OF_WANDS','DEATH','EIGHT_OF_CUPS','EIGHT_OF_PENTACLES','EIGHT_OF_SWORDS','EIGHT_OF_WANDS','FIVE_OF_CUPS','FIVE_OF_PENTACLES','FIVE_OF_SWORDS','FIVE_OF_WANDS','FOUR_OF_CUPS','FOUR_OF_PENTACLES','FOUR_OF_SWORDS','FOUR_OF_WANDS','JUDGEMENT','JUSTICE','KING_OF_CUPS','KING_OF_PENTACLES','KING_OF_SWORDS','KING_OF_WANDS','KNIGHT_OF_CUPS','KNIGHT_OF_PENTACLES','KNIGHT_OF_SWORDS','KNIGHT_OF_WANDS','NINE_OF_CUPS','NINE_OF_PENTACLES','NINE_OF_SWORDS','NINE_OF_WANDS','PAGE_OF_CUPS','PAGE_OF_PENTACLES','PAGE_OF_SWORDS','PAGE_OF_WANDS','QUEEN_OF_CUPS','QUEEN_OF_PENTACLES','QUEEN_OF_SWORDS','QUEEN_OF_WANDS','SEVEN_OF_CUPS','SEVEN_OF_PENTACLES','SEVEN_OF_SWORDS','SEVEN_OF_WANDS','SIX_OF_CUPS','SIX_OF_PENTACLES','SIX_OF_SWORDS','SIX_OF_WANDS','STRENGTH','TEMPERANCE','TEN_OF_CUPS','TEN_OF_PENTACLES','TEN_OF_SWORDS','TEN_OF_WANDS','THE_CHARIOT','THE_DEVIL','THE_EMPEROR','THE_EMPRESS','THE_FOOL','THE_HANGED_MAN','THE_HERMIT','THE_HIEROPHANT','THE_HIGH_PRIESTESS','THE_LOVERS','THE_MAGICIAN','THE_MOON','THE_STAR','THE_SUN','THE_TOWER','THE_WORLD','THREE_OF_CUPS','THREE_OF_PENTACLES','THREE_OF_SWORDS','THREE_OF_WANDS','TWO_OF_CUPS','TWO_OF_PENTACLES','TWO_OF_SWORDS','TWO_OF_WANDS','WHEEL_OF_FORTUNE']::text[] THEN RAISE EXCEPTION 'Tarot catalog must map exactly 78 canonical cards'; END IF;
 FOR mapping IN SELECT * FROM jsonb_array_elements(manifest->'mappings') LOOP
  IF jsonb_typeof(mapping) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(mapping))<>2 OR
   NOT (mapping ?& ARRAY['cardKey','assetId']) OR jsonb_typeof(mapping->'assetId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid tarot mapping'; END IF;
  SELECT * INTO a FROM platform_assets WHERE id=(mapping->>'assetId')::uuid FOR SHARE;
  IF a.id IS NULL OR a.metadata->>'kind' IS DISTINCT FROM 'TAROT_CARD_IMAGE' OR
   a.metadata->>'status' IS DISTINCT FROM 'READY' OR a.metadata->'rights'->>'state' IS DISTINCT FROM 'APPROVED' OR
   a.metadata->'rights'->>'classification' NOT IN ('PLATFORM_ORIGINAL','LICENSED','PUBLIC_DOMAIN') OR
   nullif(a.metadata->'rights'->>'evidenceReference','') IS NULL THEN RAISE EXCEPTION 'Unusable tarot asset'; END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION protect_tarot_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tarot versions must be retained'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.deck_key<>OLD.deck_key OR NEW.version<>OLD.version THEN RAISE EXCEPTION 'Immutable tarot version identity'; END IF;
  IF OLD.status IN ('PUBLISHED','RETIRED') AND
   (NEW.manifest-'status' IS DISTINCT FROM OLD.manifest-'status' OR
    NOT (NEW.status=OLD.status OR (OLD.status='PUBLISHED' AND NEW.status='RETIRED'))) THEN
   RAISE EXCEPTION 'Published tarot semantics are immutable'; END IF;
 END IF;
 IF NEW.status IN ('PUBLISHED','RETIRED') THEN
  IF TG_OP='INSERT' AND NEW.status='RETIRED' THEN RAISE EXCEPTION 'Cannot fabricate historical publication'; END IF;
  IF TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status='RETIRED' THEN RAISE EXCEPTION 'Cannot retire unpublished version'; END IF;
  PERFORM validate_tarot_manifest(NEW.manifest);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tarot_version_guard BEFORE INSERT OR UPDATE OR DELETE ON tarot_deck_versions FOR EACH ROW EXECUTE FUNCTION protect_tarot_version();
--> statement-breakpoint
CREATE FUNCTION protect_tarot_deck() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Platform deck identity/metadata are immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER tarot_deck_guard BEFORE UPDATE OR DELETE ON tarot_decks FOR EACH ROW EXECUTE FUNCTION protect_tarot_deck();
--> statement-breakpoint
CREATE FUNCTION protect_tarot_preference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v tarot_deck_versions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preference revisions must be retained'; END IF;
 PERFORM 1 FROM stores WHERE id=NEW.store_id AND organization_id=NEW.organization_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.organization_id<>OLD.organization_id OR NEW.store_id<>OLD.store_id OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Invalid preference revision/ownership'; END IF;
 IF TG_OP='INSERT' AND NEW.revision<>1 THEN RAISE EXCEPTION 'Invalid initial preference revision'; END IF;
 SELECT * INTO v FROM tarot_deck_versions WHERE deck_key=NEW.deck_key AND version=NEW.deck_version FOR SHARE;
 IF v.deck_key IS NULL OR v.status<>'PUBLISHED' THEN RAISE EXCEPTION 'Deck is not selectable'; END IF;
 PERFORM validate_tarot_manifest(v.manifest);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tarot_preference_guard BEFORE INSERT OR UPDATE OR DELETE ON store_tarot_preferences FOR EACH ROW EXECUTE FUNCTION protect_tarot_preference();
