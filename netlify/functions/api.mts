import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { and, asc, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../../db/index.js";
import { accounts, logs, oauthStates, schedules, settings, videos } from "../../db/schema.js";

const GRAPH = "https://graph.facebook.com/v23.0";
const FB_DIALOG = "https://www.facebook.com/v23.0/dialog/oauth";
const X_AUTHORIZE = "https://x.com/i/oauth2/authorize";
const X_TOKEN = "https://api.x.com/2/oauth2/token";
const X_API = "https://api.x.com/2";
const STATE_TTL_MS = 15 * 60 * 1000;
const SECRET_KEYS = new Set(["x_client_secret", "fb_client_secret", "fb_page_access_token"]);

const DEFAULT_SETTINGS: Record<string, string> = {
  x_client_id: "",
  fb_client_id: "",
  fb_page_access_token: "",
  fb_page_id: "",
  fb_page_name: "Praja sanketam",
  fb_connection_status: "disconnected",
  logo_path: "",
  logo_position: "bottom-right",
  logo_size: "medium",
  logo_opacity: "90",
  auto_publish: "false",
  max_daily_posts: "10",
};

const DEFAULT_TIMES = ["08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "18:30", "20:00", "21:30"];

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  await db
    .insert(settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schedules);
  if (count === 0) {
    await db.insert(schedules).values(DEFAULT_TIMES.map((timeStr) => ({ timeStr, enabled: true })));
  }
  seeded = true;
}

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  const s: Record<string, string> = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
  // Fall back to a Page token configured directly as environment variables.
  if (!s.fb_page_access_token && process.env.META_PAGE_ACCESS_TOKEN && process.env.META_PAGE_ID) {
    s.fb_page_access_token = process.env.META_PAGE_ACCESS_TOKEN;
    s.fb_page_id = process.env.META_PAGE_ID;
  }
  if (process.env.MAX_DAILY_POSTS && !rows.some((r) => r.key === "max_daily_posts" && r.value !== "10")) {
    s.max_daily_posts = process.env.MAX_DAILY_POSTS;
  }
  return s;
}

async function setSetting(key: string, value: string) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

async function addLog(level: string, message: string, details?: string | null) {
  await db.insert(logs).values({ level, message, details: details ?? null });
}

// Credentials: environment variables take precedence; settings (Client/App ID only) act as a fallback.
function creds(s: Record<string, string>) {
  return {
    xClientId: process.env.X_CLIENT_ID || s.x_client_id || "",
    xClientSecret: process.env.X_CLIENT_SECRET || "",
    fbAppId: process.env.FB_CLIENT_ID || s.fb_client_id || "",
    fbAppSecret: process.env.FB_CLIENT_SECRET || "",
  };
}

function appUrl(req: Request) {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (error: string, status = 400) => json({ error }, status);
const redirectTo = (req: Request, params: Record<string, string>) =>
  Response.redirect(`${appUrl(req)}/?${new URLSearchParams(params).toString()}`, 302);

async function consumeState(state: string, provider: string) {
  const [row] = await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.state, state), eq(oauthStates.provider, provider)))
    .returning();
  if (!row) return null;
  if (row.createdAt && Date.now() - new Date(row.createdAt).getTime() > STATE_TTL_MS) return null;
  return row;
}

async function cleanupStates() {
  await db.delete(oauthStates).where(lt(oauthStates.createdAt, new Date(Date.now() - STATE_TTL_MS)));
}

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function publishedToday() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(videos)
    .where(and(eq(videos.status, "published"), gte(videos.publishedAt, startOfTodayUtc())));
  return count;
}

function serializeAccount(a: typeof accounts.$inferSelect) {
  return {
    id: a.id,
    x_user_id: a.xUserId,
    username: a.username,
    name: a.name,
    avatar: a.avatar,
    followers: a.followers,
    connected_status: a.connectedStatus,
    last_checked: a.lastChecked,
    created_at: a.createdAt,
  };
}

// ---------------- X (Twitter) OAuth 2.0 PKCE ----------------

async function xInit(req: Request) {
  const s = await getSettings();
  const { xClientId } = creds(s);
  if (!xClientId) {
    return fail("X Client ID is not configured. Set the X_CLIENT_ID environment variable or add it in Settings.");
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(accounts);
  if (count >= 10) return fail("Maximum limit of 10 monitored X accounts reached.");

  await cleanupStates();
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  await db.insert(oauthStates).values({ state, provider: "x", codeVerifier });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: xClientId,
    redirect_uri: `${appUrl(req)}/api/auth/x/callback`,
    scope: "tweet.read users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return json({ authUrl: `${X_AUTHORIZE}?${params.toString()}` });
}

async function xCallback(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const error = q.get("error");
    if (error) return redirectTo(req, { error: q.get("error_description") || error });
    const code = q.get("code");
    const state = q.get("state");
    if (!code || !state) return redirectTo(req, { error: "Missing_OAuth_Parameters" });

    const stateRow = await consumeState(state, "x");
    if (!stateRow) return redirectTo(req, { error: "Invalid_or_expired_OAuth_state_-_please_try_connecting_again" });

    const s = await getSettings();
    const { xClientId, xClientSecret } = creds(s);

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: xClientId,
      code,
      redirect_uri: `${appUrl(req)}/api/auth/x/callback`,
      code_verifier: stateRow.codeVerifier || "",
    });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (xClientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${xClientId}:${xClientSecret}`).toString("base64")}`;
    }

    const tokenRes = await fetch(X_TOKEN, { method: "POST", headers, body: body.toString() });
    const tokenData = (await tokenRes.json().catch(() => ({}))) as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData.error_description || tokenData.error || `X token exchange failed (HTTP ${tokenRes.status})`;
      await addLog("error", "X OAuth token exchange failed", msg);
      return redirectTo(req, { error: msg });
    }

    const userRes = await fetch(`${X_API}/users/me?user.fields=profile_image_url,public_metrics`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = (await userRes.json().catch(() => ({}))) as any;
    if (!userRes.ok || !userData.data) {
      const msg = userData.detail || userData.title || "Failed to fetch X user profile";
      await addLog("error", "X profile fetch failed", msg);
      return redirectTo(req, { error: msg });
    }

    const u = userData.data;
    const values = {
      xUserId: String(u.id),
      username: u.username,
      name: u.name || u.username,
      avatar: u.profile_image_url || null,
      followers: u.public_metrics?.followers_count ?? 0,
      connectedStatus: "connected",
      accessToken: tokenData.access_token as string,
      refreshToken: (tokenData.refresh_token as string) || null,
      tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 7200) * 1000),
      lastChecked: new Date(),
    };

    const [existing] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(or(eq(accounts.xUserId, values.xUserId), eq(accounts.username, values.username)));
    if (existing) {
      await db.update(accounts).set(values).where(eq(accounts.id, existing.id));
    } else {
      await db.insert(accounts).values(values);
    }

    await addLog("success", `Connected X account @${values.username} via OAuth 2.0 PKCE`, `X User ID: ${values.xUserId}`);
    return redirectTo(req, { success: "X_Account_Connected" });
  } catch (err: any) {
    return redirectTo(req, { error: err.message || "X login failed" });
  }
}

async function refreshXToken(account: typeof accounts.$inferSelect) {
  if (!account.refreshToken) return null;
  const { xClientId, xClientSecret } = creds(await getSettings());
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (xClientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${xClientId}:${xClientSecret}`).toString("base64")}`;
  }
  const res = await fetch(X_TOKEN, {
    method: "POST",
    headers,
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.refreshToken, client_id: xClientId }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data.access_token) return null;
  await db
    .update(accounts)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken,
      tokenExpiresAt: new Date(Date.now() + (data.expires_in || 7200) * 1000),
    })
    .where(eq(accounts.id, account.id));
  return data.access_token as string;
}

async function testAccount(id: number) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!account || !account.accessToken) return fail("Account not connected or missing access token.");

  const call = (token: string) => fetch(`${X_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
  let res = await call(account.accessToken);
  if (res.status === 401) {
    const newToken = await refreshXToken(account);
    if (newToken) res = await call(newToken);
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.ok && data.data) {
    await db.update(accounts).set({ connectedStatus: "connected", lastChecked: new Date() }).where(eq(accounts.id, id));
    return json({ success: true, message: `Successfully verified connection for @${account.username}` });
  }
  await db.update(accounts).set({ connectedStatus: "expired" }).where(eq(accounts.id, id));
  return fail("X Token expired or unauthorized. Please reconnect.");
}

// ---------------- Facebook (Meta) OAuth ----------------

async function fbInit(req: Request) {
  const s = await getSettings();
  const { fbAppId, fbAppSecret } = creds(s);
  if (!fbAppId) {
    return fail("Facebook App ID is not configured. Set the FB_CLIENT_ID environment variable or add it in Settings.");
  }
  if (!fbAppSecret) {
    return fail("Facebook App Secret is not configured. Set the FB_CLIENT_SECRET environment variable.");
  }
  await cleanupStates();
  const state = crypto.randomBytes(16).toString("hex");
  await db.insert(oauthStates).values({ state, provider: "fb", codeVerifier: "" });

  const params = new URLSearchParams({
    client_id: fbAppId,
    redirect_uri: `${appUrl(req)}/api/auth/fb/callback`,
    scope: "pages_show_list,pages_read_engagement,pages_manage_posts",
    response_type: "code",
    state,
  });
  return json({ authUrl: `${FB_DIALOG}?${params.toString()}` });
}

async function fbCallback(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const error = q.get("error");
    if (error) return redirectTo(req, { error: q.get("error_description") || q.get("error_reason") || error });
    const code = q.get("code");
    const state = q.get("state");
    if (!code || !state) return redirectTo(req, { error: "Missing_FB_OAuth_Parameters" });

    const stateRow = await consumeState(state, "fb");
    if (!stateRow) return redirectTo(req, { error: "Invalid_or_expired_OAuth_state_-_please_try_connecting_again" });

    const { fbAppId, fbAppSecret } = creds(await getSettings());
    const tokenParams = new URLSearchParams({
      client_id: fbAppId,
      client_secret: fbAppSecret,
      redirect_uri: `${appUrl(req)}/api/auth/fb/callback`,
      code,
    });
    const tokenRes = await fetch(`${GRAPH}/oauth/access_token?${tokenParams.toString()}`);
    const tokenData = (await tokenRes.json().catch(() => ({}))) as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData.error?.message || "Facebook token exchange failed";
      await addLog("error", "Facebook OAuth token exchange failed", msg);
      return redirectTo(req, { error: msg });
    }

    // Exchange for a long-lived user token so the derived Page token does not expire.
    let userToken: string = tokenData.access_token;
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: fbAppId,
        client_secret: fbAppSecret,
        fb_exchange_token: userToken,
      }).toString()}`,
    );
    const longData = (await longRes.json().catch(() => ({}))) as any;
    if (longRes.ok && longData.access_token) userToken = longData.access_token;

    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token", access_token: userToken }).toString()}`,
    );
    const pagesData = (await pagesRes.json().catch(() => ({}))) as any;
    if (!pagesRes.ok || !Array.isArray(pagesData.data)) {
      const msg = pagesData.error?.message || "Failed to fetch Facebook Pages";
      await addLog("error", "Facebook Pages fetch failed", msg);
      return redirectTo(req, { error: msg });
    }

    const pages = pagesData.data as any[];
    const page = pages.find((p) => String(p.name || "").toLowerCase().includes("praja sanketam")) || pages[0];
    if (!page) {
      return redirectTo(req, {
        error: "No Facebook Pages found. Make sure you selected your Page in the Facebook permission dialog.",
      });
    }

    await setSetting("fb_page_id", page.id);
    await setSetting("fb_page_name", page.name);
    await setSetting("fb_page_access_token", page.access_token);
    await setSetting("fb_connection_status", "connected");
    await addLog("success", `Connected Facebook Page "${page.name}" via Meta OAuth`, `Page ID: ${page.id}`);
    return redirectTo(req, { success: "Facebook_Page_Connected" });
  } catch (err: any) {
    return redirectTo(req, { error: err.message || "Facebook login failed" });
  }
}

async function fbTest() {
  const s = await getSettings();
  if (!s.fb_page_id || !s.fb_page_access_token) return fail("Facebook Page ID or Token is missing.");
  const res = await fetch(
    `${GRAPH}/${s.fb_page_id}?${new URLSearchParams({ fields: "id,name", access_token: s.fb_page_access_token }).toString()}`,
  );
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.ok && data.id) {
    await setSetting("fb_connection_status", "connected");
    return json({ success: true, message: `Successfully verified connection to Facebook Page "${data.name || s.fb_page_name}"` });
  }
  await setSetting("fb_connection_status", "error");
  return fail(data.error?.message || "Facebook token verification failed.");
}

// ---------------- Videos ----------------

async function listVideos(status: string | null) {
  const rows = await db
    .select({ v: videos, a: { username: accounts.username, name: accounts.name, avatar: accounts.avatar } })
    .from(videos)
    .leftJoin(accounts, eq(videos.accountId, accounts.id))
    .where(status && status !== "all" ? eq(videos.status, status) : undefined)
    .orderBy(desc(videos.createdAt));
  return rows.map(({ v, a }) => ({
    id: v.id,
    account_id: v.accountId,
    x_post_id: v.xPostId,
    post_text: v.postText,
    original_video_url: v.originalVideoUrl,
    thumbnail_url: v.thumbnailUrl,
    duration: v.duration,
    status: v.status,
    processed_video_path: v.processedVideoPath,
    fb_post_id: v.fbPostId,
    error_message: v.errorMessage,
    ownership_confirmed: v.ownershipConfirmed,
    created_at: v.createdAt,
    published_at: v.publishedAt,
    account_username: a?.username ?? null,
    account_name: a?.name ?? null,
    account_avatar: a?.avatar ?? null,
  }));
}

async function scanAccounts() {
  const connected = await db.select().from(accounts).where(eq(accounts.connectedStatus, "connected"));
  if (connected.length === 0) {
    return fail("No connected X accounts found. Please connect at least one X account via OAuth first.");
  }
  let found = 0;
  const errors: string[] = [];
  for (const acc of connected) {
    let token = acc.accessToken || "";
    const call = (t: string) =>
      fetch(
        `${X_API}/users/${acc.xUserId}/tweets?${new URLSearchParams({
          max_results: "10",
          exclude: "retweets,replies",
          expansions: "attachments.media_keys",
          "tweet.fields": "created_at,text",
          "media.fields": "type,preview_image_url,duration_ms,variants",
        }).toString()}`,
        { headers: { Authorization: `Bearer ${t}` } },
      );
    let res = await call(token);
    if (res.status === 401) {
      const refreshed = await refreshXToken(acc);
      if (refreshed) res = await call((token = refreshed));
    }
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      errors.push(`@${acc.username}: ${data.detail || data.title || `HTTP ${res.status}`}`);
      if (res.status === 401) await db.update(accounts).set({ connectedStatus: "expired" }).where(eq(accounts.id, acc.id));
      continue;
    }
    const media = new Map<string, any>((data.includes?.media || []).map((m: any) => [m.media_key, m]));
    for (const tweet of data.data || []) {
      const vid = (tweet.attachments?.media_keys || []).map((k: string) => media.get(k)).find((m: any) => m?.type === "video");
      if (!vid) continue;
      const mp4 = (vid.variants || [])
        .filter((v: any) => v.content_type === "video/mp4")
        .sort((a: any, b: any) => (b.bit_rate || 0) - (a.bit_rate || 0))[0];
      if (!mp4) continue;
      const secs = Math.round((vid.duration_ms || 0) / 1000);
      const inserted = await db
        .insert(videos)
        .values({
          accountId: acc.id,
          xPostId: tweet.id,
          postText: tweet.text,
          originalVideoUrl: mp4.url,
          thumbnailUrl: vid.preview_image_url || null,
          duration: `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`,
          status: "detected",
          ownershipConfirmed: 0,
        })
        .onConflictDoNothing()
        .returning({ id: videos.id });
      found += inserted.length;
    }
    await db.update(accounts).set({ lastChecked: new Date() }).where(eq(accounts.id, acc.id));
  }
  await addLog(
    errors.length ? "warning" : "success",
    "Scanned X accounts",
    `Detected ${found} new video posts.${errors.length ? ` Errors: ${errors.join("; ")}` : ""}`,
  );
  return json({ success: true, newDetected: found, errors });
}

async function processVideo(id: number) {
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video) return fail("Video not found", 404);
  // FFmpeg is not available in serverless functions; the original video is approved as-is.
  await db
    .update(videos)
    .set({ processedVideoPath: video.originalVideoUrl, status: "approved" })
    .where(eq(videos.id, id));
  await addLog("success", `Approved video #${id} for publishing`, "Logo overlay is not applied in the serverless runtime.");
  return json({ success: true, processed_video_path: video.originalVideoUrl });
}

async function publishVideo(id: number) {
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video) return fail("Video not found", 404);
  if (!video.ownershipConfirmed) {
    return fail("Ownership and reuse permission confirmation is required before publishing.");
  }
  const s = await getSettings();
  if (!s.fb_page_access_token || !s.fb_page_id) {
    return fail("Facebook Page is not connected. Please connect via Meta OAuth first.");
  }
  const maxDaily = parseInt(s.max_daily_posts || "10", 10);
  if ((await publishedToday()) >= maxDaily) {
    return fail(`Daily publishing limit reached (${maxDaily} posts). Try again tomorrow.`);
  }

  let errorMsg: string | null = null;
  let fbPostId: string | null = null;
  try {
    const res = await fetch(`${GRAPH}/${s.fb_page_id}/videos`, {
      method: "POST",
      body: new URLSearchParams({
        description: `${video.postText || ""}\n\nPublished via Praja Sanketam Video Automation`,
        file_url: video.processedVideoPath || video.originalVideoUrl || "",
        access_token: s.fb_page_access_token,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (data.id) fbPostId = String(data.id);
    else errorMsg = data.error?.message || `HTTP ${res.status}`;
  } catch (e: any) {
    errorMsg = e.message;
  }

  if (!fbPostId) {
    await db.update(videos).set({ status: "failed", errorMessage: errorMsg }).where(eq(videos.id, id));
    await addLog("error", `Failed publishing video #${id} to Facebook`, errorMsg);
    return fail(`Facebook Graph API error: ${errorMsg}`);
  }
  await db.update(videos).set({ status: "published", fbPostId, publishedAt: new Date() }).where(eq(videos.id, id));
  await addLog("success", `Published video #${id} to Facebook Page "${s.fb_page_name}"`, `Post ID: ${fbPostId}`);
  return json({ success: true, fb_post_id: fbPostId });
}

// ---------------- Settings ----------------

async function saveSettings(req: Request) {
  const form = await req.formData();
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" || !allowed.has(key) || SECRET_KEYS.has(key)) continue;
    if (value.trim() !== "") await setSetting(key, value.trim());
  }
  const file = form.get("logo_file");
  if (file && typeof file !== "string" && file.size > 0) {
    const key = `logo-${Date.now()}.png`;
    await getStore("uploads").set(key, await file.arrayBuffer(), { metadata: { contentType: file.type || "image/png" } });
    await setSetting("logo_path", `/api/uploads/${key}`);
  }
  await addLog("success", "Updated system settings", "Saved successfully");
  return json({ success: true });
}

async function serveUpload(key: string) {
  const res = await getStore("uploads").getWithMetadata(key, { type: "arrayBuffer" });
  if (!res) return new Response("Not found", { status: 404 });
  return new Response(res.data, {
    headers: { "Content-Type": String(res.metadata?.contentType || "application/octet-stream") },
  });
}

// ---------------- Router ----------------

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const m = req.method;
  let match: RegExpMatchArray | null;

  try {
    await ensureSeeded();

    if (m === "GET" && path === "/auth/x/init") return await xInit(req);
    if (m === "GET" && path === "/auth/x/callback") return await xCallback(req);
    if (m === "GET" && path === "/auth/fb/init") return await fbInit(req);
    if (m === "GET" && path === "/auth/fb/callback") return await fbCallback(req);
    if (m === "POST" && path === "/auth/fb/test") return await fbTest();
    if (m === "POST" && path === "/auth/fb/disconnect") {
      await setSetting("fb_page_access_token", "");
      await setSetting("fb_page_id", "");
      await setSetting("fb_connection_status", "disconnected");
      await addLog("info", "Disconnected Facebook Page", "User action");
      return json({ success: true });
    }

    if (m === "GET" && path === "/dashboard/stats") {
      const all = await db.select({ s: accounts.connectedStatus }).from(accounts);
      const vids = await db.select({ s: videos.status }).from(videos);
      const s = await getSettings();
      return json({
        totalAccounts: all.length,
        connectedAccounts: all.filter((a) => a.s === "connected").length,
        detectedVideos: vids.length,
        pendingVideos: vids.filter((v) => v.s === "pending" || v.s === "detected").length,
        publishedVideos: vids.filter((v) => v.s === "published").length,
        failedVideos: vids.filter((v) => v.s === "failed").length,
        dailyCount: await publishedToday(),
        maxDaily: parseInt(s.max_daily_posts || "10", 10),
      });
    }

    if (m === "GET" && path === "/accounts") {
      const rows = await db.select().from(accounts).orderBy(desc(accounts.id));
      return json(rows.map(serializeAccount));
    }
    if (m === "POST" && path === "/accounts/scan") return await scanAccounts();
    if ((match = path.match(/^\/accounts\/(\d+)\/disconnect$/)) && m === "POST") {
      const id = Number(match[1]);
      await db
        .update(accounts)
        .set({ connectedStatus: "disconnected", accessToken: null, refreshToken: null })
        .where(eq(accounts.id, id));
      await addLog("info", `Disconnected X account ID #${id}`, "User action");
      return json({ success: true });
    }
    if ((match = path.match(/^\/accounts\/(\d+)\/test$/)) && m === "POST") return await testAccount(Number(match[1]));
    if ((match = path.match(/^\/accounts\/(\d+)$/)) && m === "DELETE") {
      await db.delete(accounts).where(eq(accounts.id, Number(match[1])));
      return json({ success: true });
    }

    if (m === "GET" && path === "/videos") return json(await listVideos(url.searchParams.get("status")));
    if ((match = path.match(/^\/videos\/(\d+)$/)) && m === "PATCH") {
      const body = (await req.json().catch(() => ({}))) as any;
      const set: Partial<typeof videos.$inferInsert> = {};
      if (body.status !== undefined) set.status = String(body.status);
      if (body.ownership_confirmed !== undefined) set.ownershipConfirmed = Number(body.ownership_confirmed) ? 1 : 0;
      if (body.post_text !== undefined) set.postText = String(body.post_text);
      if (Object.keys(set).length === 0) return fail("No fields to update");
      await db.update(videos).set(set).where(eq(videos.id, Number(match[1])));
      return json({ success: true });
    }
    if ((match = path.match(/^\/videos\/(\d+)\/process$/)) && m === "POST") return await processVideo(Number(match[1]));
    if ((match = path.match(/^\/videos\/(\d+)\/publish$/)) && m === "POST") return await publishVideo(Number(match[1]));

    if (m === "GET" && path === "/settings") {
      const s = await getSettings();
      for (const k of SECRET_KEYS) delete s[k];
      const c = creds(s);
      return json({
        ...s,
        x_client_id: s.x_client_id || c.xClientId,
        fb_client_id: s.fb_client_id || c.fbAppId,
        x_callback_url: `${appUrl(req)}/api/auth/x/callback`,
        fb_callback_url: `${appUrl(req)}/api/auth/fb/callback`,
      });
    }
    if (m === "POST" && path === "/settings") return await saveSettings(req);

    if (m === "GET" && path === "/schedules") {
      const rows = await db.select().from(schedules).orderBy(asc(schedules.timeStr));
      return json(
        rows.map((r) => ({
          id: r.id,
          time_str: r.timeStr,
          enabled: r.enabled ? 1 : 0,
          assigned_video_id: r.assignedVideoId,
          status: r.status,
        })),
      );
    }
    if (m === "GET" && path === "/logs") {
      return json(await db.select().from(logs).orderBy(desc(logs.id)).limit(100));
    }
    if ((match = path.match(/^\/uploads\/([\w.-]+)$/)) && m === "GET") return await serveUpload(match[1]);

    return fail("Not found", 404);
  } catch (err: any) {
    console.error(err);
    return fail(err.message || "Internal server error", 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
