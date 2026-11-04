CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY,
	"x_user_id" text UNIQUE,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"followers" integer DEFAULT 0,
	"connected_status" text DEFAULT 'disconnected',
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"last_checked" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY,
	"timestamp" timestamp DEFAULT now(),
	"level" text NOT NULL,
	"message" text NOT NULL,
	"details" text
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY,
	"provider" text NOT NULL,
	"code_verifier" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY,
	"time_str" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"assigned_video_id" integer,
	"status" text DEFAULT 'idle'
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY,
	"account_id" integer,
	"x_post_id" text NOT NULL UNIQUE,
	"post_text" text,
	"original_video_url" text,
	"thumbnail_url" text,
	"duration" text,
	"status" text DEFAULT 'detected',
	"processed_video_path" text,
	"fb_post_id" text,
	"error_message" text,
	"ownership_confirmed" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"published_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;