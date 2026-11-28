CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_base64" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attachments_company_entity_idx" ON "attachments" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attachments_company_created_idx" ON "attachments" USING btree ("company_id","created_at");
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attachments"
  USING ("company_id" = (select nullif(current_setting('app.company_id', true), '')))
  WITH CHECK ("company_id" = (select nullif(current_setting('app.company_id', true), '')));
GRANT SELECT, INSERT, UPDATE, DELETE ON "attachments" TO "app_user";
