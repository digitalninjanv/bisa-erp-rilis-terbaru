CREATE TABLE "opname_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"category_id" uuid,
	"assignee_id" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"document_id" uuid,
	"notes" text,
	"created_by" text,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "adjustment_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "opname_cycle" jsonb;--> statement-breakpoint
ALTER TABLE "opname_tasks" ADD CONSTRAINT "opname_tasks_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opname_tasks" ADD CONSTRAINT "opname_tasks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opname_tasks" ADD CONSTRAINT "opname_tasks_document_id_stock_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."stock_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opname_tasks_company_status_idx" ON "opname_tasks" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "opname_tasks_company_assignee_idx" ON "opname_tasks" USING btree ("company_id","assignee_id","status");--> statement-breakpoint
-- A-24 T3 manual additions, same file by design (pattern of
-- 0027/0033/0038/0046/0050): tenant RLS + grant for the new table.
ALTER TABLE "opname_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opname_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "opname_tasks"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "opname_tasks" TO app_user;