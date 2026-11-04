# Praja Sanketam Video Automation

An automated full-stack web application designed for **Praja Sanketam** to monitor authorized X accounts, detect eligible video posts, apply transparent PNG logo overlays via FFmpeg, and publish approved videos to the official **Praja sanketam** Facebook Page using official X API (OAuth 2.0 PKCE) and Meta Graph API.

---

## Key Features

1. **Official X Account Integration**:
   - OAuth 2.0 Authorization Code Flow with PKCE.
   - Connect up to 10 authorized X accounts securely.
   - Real connection status indicators (Connected, Expired, Error) with Test Connection and Disconnect actions.

2. **FFmpeg Video Branding Engine**:
   - Ingests MP4 videos from detected X posts.
   - Applies transparent PNG logo overlays at configurable positions (bottom-right, bottom-left, top-right, top-left).
   - Preserves video quality, aspect ratio, and audio codecs.

3. **Facebook Page Publishing (Praja sanketam)**:
   - Official Meta OAuth integration.
   - Securely stores Page Access Tokens on the backend.
   - Uploads processed videos with original X post text as captions.
   - Tracks actual Facebook Post IDs and status.

4. **Approval Center & Safety**:
   - Manual review required by default (auto-publishing OFF).
   - Mandatory ownership and reuse-permission confirmation checklist for every video before publishing.

5. **Scheduler & Limits**:
   - Maximum 10 posts daily in `Asia/Kolkata` timezone.
   - Default daily schedule slots (`08:00`, `09:30`, `11:00`, `12:30`, `14:00`, `15:30`, `17:00`, `18:30`, `20:00`, `21:30`).

---

## Environment Variables (.env.example)

Configure the following environment variables in your deployment environment (e.g. Netlify environment variables or `.env` file):

```env
# X (Twitter) API OAuth 2.0 Credentials
X_CLIENT_ID="your_x_client_id"
X_CLIENT_SECRET="your_x_client_secret"

# Meta (Facebook) App Credentials
FB_CLIENT_ID="your_facebook_app_id"
FB_CLIENT_SECRET="your_facebook_app_secret"

# Server Port
PORT=3000
```

---

## Deployment Instructions (Netlify & Server)

1. **Local Development**:
   ```bash
   npm install
   npm run dev
   ```

2. **Production Build**:
   ```bash
   npm run build
   ```

3. **Netlify Deployment**:
   - Connect your repository to Netlify.
   - Build Command: `npm run build`
   - Publish Directory: `dist`
   - Set environment variables (`X_CLIENT_ID`, `X_CLIENT_SECRET`, `FB_CLIENT_ID`, `FB_CLIENT_SECRET`) in Netlify Site Settings.
   - For full-stack backend functions / server, ensure Node server runtime is configured or deploy via Docker / Cloud Run container with FFmpeg installed.
