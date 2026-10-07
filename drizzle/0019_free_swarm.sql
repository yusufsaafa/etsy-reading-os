CREATE TABLE "document_media_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"document_snapshot_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"media_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_media_intent" UNIQUE("organization_id","store_id","document_snapshot_id","media_hash"),
	CONSTRAINT "document_media_bounds" CHECK ("document_media_snapshots"."media_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("document_media_snapshots"."payload")='object' and octet_length("document_media_snapshots"."payload"::text)<=30000 and "document_media_snapshots"."payload"->>'contractVersion'='document-media-snapshot/v1')
);
--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD COLUMN "approved_media" jsonb;--> statement-breakpoint
ALTER TABLE "document_media_snapshots" ADD CONSTRAINT "document_media_snapshots_organization_id_store_id_review_id_reading_reviews_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","review_id") REFERENCES "public"."reading_reviews"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_media_snapshots" ADD CONSTRAINT "document_media_snapshots_organization_id_store_id_reading_id_fulfillment_units_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","reading_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_media_snapshots" ADD CONSTRAINT "document_media_snapshots_organization_id_store_id_generation_id_generations_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","generation_id") REFERENCES "public"."generations"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_media_snapshots" ADD CONSTRAINT "document_media_snapshots_document_snapshot_id_document_snapshots_id_fk" FOREIGN KEY ("document_snapshot_id") REFERENCES "public"."document_snapshots"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION validate_reading_media(requirement jsonb, media jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c jsonb; n integer; count_required integer;
BEGIN
 IF requirement->>'mode'='NONE' THEN
  IF media IS DISTINCT FROM '{"mode":"NONE"}'::jsonb OR requirement IS DISTINCT FROM '{"mode":"NONE"}'::jsonb THEN RAISE EXCEPTION 'Unexpected reading media'; END IF;
  RETURN;
 END IF;
 IF requirement->>'mode' IS DISTINCT FROM 'TAROT_CARDS' OR (SELECT count(*) FROM jsonb_object_keys(requirement))<>2 OR
  jsonb_typeof(requirement->'cardCount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid media requirement'; END IF;
 count_required=(requirement->>'cardCount')::integer;
 IF count_required NOT BETWEEN 1 AND 10 OR media->>'mode' IS DISTINCT FROM 'TAROT_CARDS' OR
  (SELECT count(*) FROM jsonb_object_keys(media))<>2 OR jsonb_typeof(media->'cards') IS DISTINCT FROM 'array' OR
  jsonb_array_length(media->'cards')<>count_required THEN RAISE EXCEPTION 'Invalid semantic cards'; END IF;
 IF (SELECT count(DISTINCT card->>'cardKey') FROM jsonb_array_elements(media->'cards') card)<>count_required THEN RAISE EXCEPTION 'Duplicate card'; END IF;
 FOR c,n IN SELECT value,ordinality::integer-1 FROM jsonb_array_elements(media->'cards') WITH ORDINALITY LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(c))<>3 OR NOT (c ?& ARRAY['cardKey','orientation','position']) OR
   jsonb_typeof(c->'position') IS DISTINCT FROM 'number' OR (c->>'position')::integer<>n OR
   c->>'orientation' IS NULL OR c->>'orientation' NOT IN ('UPRIGHT','REVERSED') OR
   c->>'cardKey' IS NULL OR NOT (c->>'cardKey'=ANY(ARRAY['ACE_OF_CUPS','ACE_OF_PENTACLES','ACE_OF_SWORDS','ACE_OF_WANDS','DEATH','EIGHT_OF_CUPS','EIGHT_OF_PENTACLES','EIGHT_OF_SWORDS','EIGHT_OF_WANDS','FIVE_OF_CUPS','FIVE_OF_PENTACLES','FIVE_OF_SWORDS','FIVE_OF_WANDS','FOUR_OF_CUPS','FOUR_OF_PENTACLES','FOUR_OF_SWORDS','FOUR_OF_WANDS','JUDGEMENT','JUSTICE','KING_OF_CUPS','KING_OF_PENTACLES','KING_OF_SWORDS','KING_OF_WANDS','KNIGHT_OF_CUPS','KNIGHT_OF_PENTACLES','KNIGHT_OF_SWORDS','KNIGHT_OF_WANDS','NINE_OF_CUPS','NINE_OF_PENTACLES','NINE_OF_SWORDS','NINE_OF_WANDS','PAGE_OF_CUPS','PAGE_OF_PENTACLES','PAGE_OF_SWORDS','PAGE_OF_WANDS','QUEEN_OF_CUPS','QUEEN_OF_PENTACLES','QUEEN_OF_SWORDS','QUEEN_OF_WANDS','SEVEN_OF_CUPS','SEVEN_OF_PENTACLES','SEVEN_OF_SWORDS','SEVEN_OF_WANDS','SIX_OF_CUPS','SIX_OF_PENTACLES','SIX_OF_SWORDS','SIX_OF_WANDS','STRENGTH','TEMPERANCE','TEN_OF_CUPS','TEN_OF_PENTACLES','TEN_OF_SWORDS','TEN_OF_WANDS','THE_CHARIOT','THE_DEVIL','THE_EMPEROR','THE_EMPRESS','THE_FOOL','THE_HANGED_MAN','THE_HERMIT','THE_HIEROPHANT','THE_HIGH_PRIESTESS','THE_LOVERS','THE_MAGICIAN','THE_MOON','THE_STAR','THE_SUN','THE_TOWER','THE_WORLD','THREE_OF_CUPS','THREE_OF_PENTACLES','THREE_OF_SWORDS','THREE_OF_WANDS','TWO_OF_CUPS','TWO_OF_PENTACLES','TWO_OF_SWORDS','TWO_OF_WANDS','WHEEL_OF_FORTUNE']::text[])) THEN RAISE EXCEPTION 'Invalid semantic card'; END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_review_base() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base jsonb; draft jsonb; rev integer; evidence generations%ROWTYPE; requirement jsonb; media jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review base is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING' THEN RAISE EXCEPTION 'Review must begin pending'; END IF;
 ELSE
  IF OLD.state<>'PENDING' OR NEW.state<>'APPROVED' OR
   (NEW.id,NEW.organization_id,NEW.store_id,NEW.unit_id,NEW.generation_id,NEW.created_at) IS DISTINCT FROM
   (OLD.id,OLD.organization_id,OLD.store_id,OLD.unit_id,OLD.generation_id,OLD.created_at) THEN
   RAISE EXCEPTION 'Review approval is immutable';
  END IF;
 END IF;
 SELECT g.* INTO evidence FROM generations g WHERE g.id=NEW.generation_id AND g.organization_id=NEW.organization_id AND g.store_id=NEW.store_id AND g.unit_id=NEW.unit_id AND g.status='SUCCEEDED' AND g.result IS NOT NULL AND g.completed_at IS NOT NULL;
 base=evidence.result;
 IF base IS NULL THEN RAISE EXCEPTION 'Review requires successful reading evidence'; END IF;
 requirement=coalesce(evidence.context->'product'->'configuration'->'readingMedia','{"mode":"NONE"}'::jsonb);
 media=coalesce(base->'readingMedia','{"mode":"NONE"}'::jsonb);
 PERFORM validate_reading_media(requirement,media);
 IF TG_OP='INSERT' AND NEW.approved_media IS NOT NULL THEN RAISE EXCEPTION 'Pending review has no approved media'; END IF;
 IF TG_OP='UPDATE' THEN
  IF requirement->>'mode'='TAROT_CARDS' AND NEW.approved_media IS NULL THEN RAISE EXCEPTION 'Tarot approval requires media'; END IF;
  IF NEW.approved_media IS NOT NULL AND (
   NEW.approved_media->>'contractVersion' IS DISTINCT FROM 'approved-reading-media/v1' OR
   NEW.approved_media->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR NEW.approved_media->>'storeId' IS DISTINCT FROM NEW.store_id::text OR
   NEW.approved_media->>'readingId' IS DISTINCT FROM NEW.unit_id::text OR
   NEW.approved_media->'provenance'->>'reviewId' IS DISTINCT FROM NEW.id::text OR NEW.approved_media->'provenance'->>'generationId' IS DISTINCT FROM NEW.generation_id::text OR
   NEW.approved_media->'requirement' IS DISTINCT FROM requirement OR NEW.approved_media->'media' IS DISTINCT FROM media OR
   (NEW.approved_media->>'approvedAt')::timestamptz IS DISTINCT FROM NEW.approved_at OR
   NEW.approved_media->>'mediaHash' IS NULL OR NEW.approved_media->>'mediaHash' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid approved media provenance'; END IF;
  SELECT d.content,d.revision INTO draft,rev FROM reading_review_drafts d WHERE d.review_id=NEW.id AND d.organization_id=NEW.organization_id AND d.store_id=NEW.store_id FOR UPDATE;
  IF NEW.approved_content IS DISTINCT FROM coalesce(draft,jsonb_build_object('sections',base->'sections')) OR NEW.approved_draft_revision IS DISTINCT FROM rev THEN
   RAISE EXCEPTION 'Approval must freeze current durable reading';
  END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_review_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review draft cannot be reset'; END IF;
 IF TG_OP='UPDATE' AND (NEW.review_id<>OLD.review_id OR NEW.organization_id<>OLD.organization_id OR NEW.store_id<>OLD.store_id OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Review draft identity or revision is invalid'; END IF;
 IF TG_OP='INSERT' AND NEW.revision<>0 THEN RAISE EXCEPTION 'Review draft must begin at zero'; END IF;
 SELECT g.result INTO base FROM reading_reviews r JOIN generations g ON g.id=r.generation_id AND g.organization_id=r.organization_id AND g.store_id=r.store_id
 WHERE r.id=NEW.review_id AND r.organization_id=NEW.organization_id AND r.store_id=NEW.store_id AND r.state='PENDING';
 IF base IS NULL OR jsonb_typeof(NEW.content)<>'object' OR jsonb_typeof(NEW.content->'sections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Review draft structure is invalid'; END IF;
 IF jsonb_array_length(NEW.content->'sections')<>jsonb_array_length(base->'sections') THEN RAISE EXCEPTION 'Review draft sections are fixed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content->'sections') WITH ORDINALITY s(section,n) WHERE
 s.section->>'sectionId' IS DISTINCT FROM (base->'sections'->(s.n::int-1)->>'sectionId') OR
 s.section->>'title' IS DISTINCT FROM (base->'sections'->(s.n::int-1)->>'title') OR jsonb_typeof(s.section->'content') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Review draft sections are fixed'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(NEW.content))<>1 THEN RAISE EXCEPTION 'Drafts edit text only'; END IF;
 IF TG_OP='INSERT' AND NEW.content<>jsonb_build_object('sections',base->'sections') THEN RAISE EXCEPTION 'Review draft begins from pinned evidence'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION protect_document_media() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d document_snapshots%ROWTYPE; r reading_reviews%ROWTYPE; v tarot_deck_versions%ROWTYPE; a platform_assets%ROWTYPE; c jsonb; semantic jsonb; mode text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Document media is immutable'; END IF;
 PERFORM 1 FROM stores WHERE id=NEW.store_id AND organization_id=NEW.organization_id FOR UPDATE;
 SELECT * INTO d FROM document_snapshots WHERE id=NEW.document_snapshot_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND reading_id=NEW.reading_id AND review_id=NEW.review_id AND generation_id=NEW.generation_id;
 SELECT * INTO r FROM reading_reviews WHERE id=NEW.review_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND unit_id=NEW.reading_id AND generation_id=NEW.generation_id AND state='APPROVED';
 IF d.id IS NULL OR r.id IS NULL OR
  NEW.payload->>'id' IS DISTINCT FROM NEW.id::text OR NEW.payload->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR NEW.payload->>'storeId' IS DISTINCT FROM NEW.store_id::text OR
  NEW.payload->>'documentSnapshotId' IS DISTINCT FROM NEW.document_snapshot_id::text OR NEW.payload->>'readingId' IS DISTINCT FROM NEW.reading_id::text OR
  NEW.payload->'provenance'->>'reviewId' IS DISTINCT FROM NEW.review_id::text OR NEW.payload->'provenance'->>'generationId' IS DISTINCT FROM NEW.generation_id::text OR
  NEW.payload->>'mediaHash' IS DISTINCT FROM NEW.media_hash OR (NEW.payload->>'createdAt')::timestamptz IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'Invalid document media provenance'; END IF;
 mode=NEW.payload->'media'->>'mode';
 IF r.approved_media IS NOT NULL AND (NEW.payload->'provenance'->>'approvedMediaHash' IS DISTINCT FROM r.approved_media->>'mediaHash' OR mode IS DISTINCT FROM r.approved_media->'media'->>'mode') THEN RAISE EXCEPTION 'Approved media mismatch'; END IF;
 IF mode='NONE' THEN
  IF NEW.payload->'media' IS DISTINCT FROM '{"mode":"NONE"}'::jsonb THEN RAISE EXCEPTION 'Unexpected media fields'; END IF;
  RETURN NEW;
 END IF;
 IF mode IS DISTINCT FROM 'TAROT_CARDS' OR r.approved_media IS NULL OR jsonb_typeof(NEW.payload->'media'->'cards') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid document media'; END IF;
 SELECT * INTO v FROM tarot_deck_versions WHERE deck_key=NEW.payload->'media'->'deck'->>'deckKey' AND version=(NEW.payload->'media'->'deck'->>'deckVersion')::integer FOR SHARE;
 IF v.deck_key IS NULL OR v.status<>'PUBLISHED' OR NOT EXISTS(SELECT 1 FROM store_tarot_preferences p WHERE p.organization_id=NEW.organization_id AND p.store_id=NEW.store_id AND p.deck_key=v.deck_key AND p.deck_version=v.version) THEN RAISE EXCEPTION 'Invalid current deck preference'; END IF;
 PERFORM validate_tarot_manifest(v.manifest);
 SELECT jsonb_agg(value-'asset' ORDER BY ordinality) INTO semantic FROM jsonb_array_elements(NEW.payload->'media'->'cards') WITH ORDINALITY;
 IF semantic IS DISTINCT FROM r.approved_media->'media'->'cards' THEN RAISE EXCEPTION 'Semantic cards mismatch'; END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(NEW.payload->'media'->'cards') LOOP
  SELECT * INTO a FROM platform_assets WHERE id=(c->'asset'->>'id')::uuid;
  IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.manifest->'mappings') m WHERE m->>'cardKey'=c->>'cardKey' AND m->>'assetId'=a.id::text) OR
   c->'asset' IS DISTINCT FROM jsonb_build_object('id',a.id::text,'contentHash',a.metadata->'contentHash','mediaType',a.metadata->'mediaType','byteSize',a.metadata->'byteSize','width',a.metadata->'width','height',a.metadata->'height') THEN RAISE EXCEPTION 'Invalid frozen asset'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_media_guard BEFORE INSERT OR UPDATE OR DELETE ON document_media_snapshots FOR EACH ROW EXECUTE FUNCTION protect_document_media();
