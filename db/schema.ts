import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: serial().primaryKey(),
  xUserId: text("x_user_id").unique(),
  username: text().notNull(),
  name: text().notNull(),
  avatar: text(),
  followers: integer().default(0),
  connectedStatus: text("connected_status").default("disconnected"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  lastChecked: timestamp("last_checked"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const videos = pgTable("videos", {
  id: serial().primaryKey(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  xPostId: text("x_post_id").notNull().unique(),
  postText: text("post_text"),
  originalVideoUrl: text("original_video_url"),
  thumbnailUrl: text("thumbnail_url"),
  duration: text(),
  status: text().default("detected"),
  processedVideoPath: text("processed_video_path"),
  fbPostId: text("fb_post_id"),
  errorMessage: text("error_message"),
  ownershipConfirmed: integer("ownership_confirmed").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  publishedAt: timestamp("published_at"),
});

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: text(),
});

export const schedules = pgTable("schedules", {
  id: serial().primaryKey(),
  timeStr: text("time_str").notNull(),
  enabled: boolean().default(true),
  assignedVideoId: integer("assigned_video_id"),
  status: text().default("idle"),
});

export const logs = pgTable("logs", {
  id: serial().primaryKey(),
  timestamp: timestamp().defaultNow(),
  level: text().notNull(),
  message: text().notNull(),
  details: text(),
});

export const oauthStates = pgTable("oauth_states", {
  state: text().primaryKey(),
  provider: text().notNull(),
  codeVerifier: text("code_verifier"),
  createdAt: timestamp("created_at").defaultNow(),
});
