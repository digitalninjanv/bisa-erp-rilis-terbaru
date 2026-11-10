CREATE INDEX "expenses_company_date_idx" ON "expenses" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "journal_entries_company_number_trgm_idx" ON "journal_entries" USING gin ("number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "journal_entries_company_description_trgm_idx" ON "journal_entries" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "payroll_items_company_employee_idx" ON "payroll_items" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "products_company_sku_trgm_idx" ON "products" USING gin ("sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_company_barcode_trgm_idx" ON "products" USING gin ("barcode" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_company_name_idx" ON "products" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "sales_company_created_idx" ON "sales" USING btree ("company_id","created_at" desc);