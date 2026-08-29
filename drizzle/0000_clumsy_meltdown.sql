CREATE TABLE "cancionero_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"code_hash" varchar(200) NOT NULL,
	"code_salt" varchar(64) NOT NULL,
	"owner_token" varchar(64) NOT NULL,
	"current_hash" text DEFAULT '#/' NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_quick_songs" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_key" varchar(16) NOT NULL,
	"position" integer NOT NULL,
	"song_id" integer NOT NULL,
	"song_title" varchar(200) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cancionero_sessions_owner_idx" ON "cancionero_sessions" USING btree ("owner_token");--> statement-breakpoint
CREATE INDEX "cancionero_sessions_name_idx" ON "cancionero_sessions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "weekly_quick_songs_week_idx" ON "weekly_quick_songs" USING btree ("week_key");