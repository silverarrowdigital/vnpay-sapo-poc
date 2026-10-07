CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"web_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer" jsonb,
	"lines" jsonb NOT NULL,
	"goods_vnd" integer NOT NULL,
	"discount" jsonb,
	"shipping" jsonb,
	"amount_vnd" integer NOT NULL,
	"payment_method" text DEFAULT 'vnpay' NOT NULL,
	"order_status" text DEFAULT 'open' NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"integration_status" text DEFAULT 'none' NOT NULL,
	"fulfillment_status" text DEFAULT 'none' NOT NULL,
	"purge_after" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL,
	"customer_purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"payload" jsonb,
	"state" text DEFAULT 'pending' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"vnp_txn_ref" text NOT NULL,
	"amount_vnd" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"vnp_transaction_no" text,
	"vnp_bank_code" text,
	"vnp_pay_date" text,
	"vnp_response_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sapo_mappings" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"sapo_order_id" bigint NOT NULL,
	"sapo_order_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"txn_ref" text,
	"params" jsonb NOT NULL,
	"rsp_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sapo_mappings" ADD CONSTRAINT "sapo_mappings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_web_ref_unique" ON "orders" USING btree ("web_ref");--> statement-breakpoint
CREATE INDEX "orders_purge_idx" ON "orders" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "outbox_jobs_due_idx" ON "outbox_jobs" USING btree ("state","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_txn_ref_unique" ON "payment_attempts" USING btree ("vnp_txn_ref");--> statement-breakpoint
CREATE INDEX "payment_attempts_order_idx" ON "payment_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "webhook_inbox_txn_ref_idx" ON "webhook_inbox" USING btree ("txn_ref");