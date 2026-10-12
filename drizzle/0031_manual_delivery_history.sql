ALTER TABLE document_artifacts ADD CONSTRAINT artifact_owned_reading_identity UNIQUE (organization_id,store_id,reading_id,id);
--> statement-breakpoint
CREATE TABLE manual_delivery_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, store_id uuid NOT NULL,
 reading_id uuid NOT NULL, artifact_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
 action text NOT NULL CHECK(action IN ('CONFIRMED','CORRECTED')),
 actor_id text NOT NULL REFERENCES app_users(id), command_id uuid NOT NULL,
 command_hash text NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=1000), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT manual_delivery_sequence UNIQUE(organization_id,store_id,reading_id,sequence),
 CONSTRAINT manual_delivery_command UNIQUE(organization_id,store_id,command_id),
 CONSTRAINT manual_delivery_owned_unit_fk FOREIGN KEY(organization_id,store_id,reading_id) REFERENCES fulfillment_units(organization_id,store_id,id),
 CONSTRAINT manual_delivery_exact_artifact_fk FOREIGN KEY(organization_id,store_id,reading_id,artifact_id) REFERENCES document_artifacts(organization_id,store_id,reading_id,id)
);
--> statement-breakpoint
CREATE FUNCTION guard_manual_delivery_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous manual_delivery_events;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'DELIVERY_HISTORY_IMMUTABLE'; END IF;
 PERFORM 1 FROM stores WHERE organization_id=NEW.organization_id AND id=NEW.store_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM memberships WHERE organization_id=NEW.organization_id AND user_id=NEW.actor_id AND role='owner') THEN RAISE EXCEPTION 'DELIVERY_OWNER_REQUIRED'; END IF;
 SELECT * INTO previous FROM manual_delivery_events WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND reading_id=NEW.reading_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence <> coalesce(previous.sequence,0)+1 THEN RAISE EXCEPTION 'DELIVERY_CONFLICT'; END IF;
 IF NEW.action='CORRECTED' THEN
  IF previous.action IS DISTINCT FROM 'CONFIRMED' OR NEW.artifact_id<>previous.artifact_id OR btrim(NEW.note)='' THEN RAISE EXCEPTION 'DELIVERY_CORRECTION_REQUIRED'; END IF;
 ELSE
  IF previous.action='CONFIRMED' THEN RAISE EXCEPTION 'DELIVERY_ALREADY_CONFIRMED'; END IF;
  IF NOT EXISTS (
   SELECT 1 FROM document_artifacts a
   JOIN document_snapshots d ON d.id=a.document_snapshot_id AND d.organization_id=a.organization_id AND d.store_id=a.store_id AND d.reading_id=a.reading_id
   JOIN reading_reviews r ON r.id=d.review_id AND r.organization_id=d.organization_id AND r.store_id=d.store_id AND r.unit_id=d.reading_id AND r.generation_id=d.generation_id
   JOIN generations g ON g.id=r.generation_id AND g.organization_id=r.organization_id AND g.store_id=r.store_id AND g.unit_id=r.unit_id
   JOIN fulfillment_units u ON u.id=r.unit_id AND u.organization_id=r.organization_id AND u.store_id=r.store_id
   JOIN order_line_items l ON l.id=u.line_item_id AND l.organization_id=u.organization_id AND l.store_id=u.store_id
   JOIN orders o ON o.id=l.order_id AND o.organization_id=l.organization_id AND o.store_id=l.store_id
   WHERE a.id=NEW.artifact_id AND a.organization_id=NEW.organization_id AND a.store_id=NEW.store_id AND a.reading_id=NEW.reading_id
    AND a.state='AVAILABLE' AND r.state='APPROVED' AND g.status='SUCCEEDED'
    AND u.product_version_id=g.product_version_id AND u.revision=g.customer_revision
    AND u.configuration_state='versioned' AND NOT u.source_changed AND u.issues='[]'::jsonb
    AND o.paid AND NOT o.canceled AND o.refund='none'
    AND d.order_id=o.id AND d.payload->'reading'->>'contentHash'=r.approved_content_hash
    AND NOT EXISTS(SELECT 1 FROM generations later WHERE later.organization_id=g.organization_id AND later.store_id=g.store_id AND later.unit_id=g.unit_id AND (later.created_at,later.id)>(g.created_at,g.id))
  ) THEN RAISE EXCEPTION 'DELIVERY_PDF_NOT_READY'; END IF;
 END IF;
 NEW.created_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER manual_delivery_event_guard BEFORE INSERT OR UPDATE OR DELETE ON manual_delivery_events FOR EACH ROW EXECUTE FUNCTION guard_manual_delivery_event();
