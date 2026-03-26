# Privacy Policy — Elliott Wave Pro

**Effective Date:** 2026-01-01
**Last Updated:** 2026-03-25

## 1. Overview

Elliott Wave Pro ("the App", "we", "us") is a financial analysis application
for iOS and Android. This Privacy Policy explains what data we collect, how
we use it, and your rights as a user.

We are committed to transparency and to your privacy. We do not sell your
personal data to any third party.

## 2. Data We Collect

### 2.1 Account Information
When you create an account, we collect:
- Email address (required for sign-in)
- Optional: name (not required)

This data is stored in Supabase (Supabase Inc., a US-based company) and is
used solely for authentication.

### 2.2 Watchlist & Trade Journal
- **Watchlist tickers**: The stock/ETF symbols you add to your watchlist are
  stored on your device (via MMKV) and optionally synced to Supabase so you
  can restore them on a new device.
- **Trade journal entries**: Your manual trade records (ticker, entry/stop/
  target prices, notes, emotional state ratings) are stored on your device
  and in your Supabase account. This data is private to your account.

### 2.3 Subscription & Purchase Data
- We use RevenueCat to manage in-app subscriptions. RevenueCat receives
  purchase receipts from Apple/Google to validate your subscription tier.
  RevenueCat's privacy policy applies to data shared with them.
- We store your subscription tier (free/pro/elite) in Supabase.

### 2.4 Usage & Analytics
- We do not use third-party analytics SDKs (no Firebase Analytics, no Amplitude).
- Vercel (our API proxy host) logs standard HTTP request metadata (IP address,
  user agent, timestamp) for security and debugging. These logs are retained
  for 30 days.

### 2.5 Voice Commands (Optional)
- If you use the Voice Navigation feature, the microphone is activated only
  while you hold the mic button.
- Voice audio is processed on-device using the operating system's speech
  recognition APIs. No audio is transmitted to our servers.

### 2.6 Market Data
- The App fetches real-time and historical market data from Polygon.io. Your
  API requests include the ticker symbols you request. No personal identifying
  information is sent to Polygon beyond what is required for their API terms.

## 3. How We Use Your Data

| Data | Purpose |
|------|---------|
| Email | Authentication only |
| Watchlist tickers | Display your personalized watchlist |
| Trade journal | Performance analytics within the app |
| Subscription tier | Gate access to Pro/Elite features |
| Market data requests | Display charts, wave counts, options data |

We do not use your data for advertising, profiling, or sale to third parties.

## 4. Data Retention

- Account data: retained until you delete your account
- Trade journal: retained in Supabase until you delete your account
- Watchlist: stored locally on device; Supabase copy deleted with account
- You may delete your account at any time via Settings → Account → Delete Account

## 5. Third-Party Services

| Service | Purpose | Privacy Policy |
|---------|---------|----------------|
| Supabase | Database & authentication | supabase.com/privacy |
| Polygon.io | Market data | polygon.io/privacy |
| RevenueCat | Subscription management | revenuecat.com/privacy |
| Vercel | API proxy hosting | vercel.com/legal/privacy-policy |
| Anthropic | AI commentary (server-side only) | anthropic.com/privacy |

## 6. Security

- Supabase uses row-level security (RLS) to ensure each user can only access
  their own data.
- Your Supabase session token is stored in encrypted MMKV storage on-device.
- Our Vercel API proxy routes Anthropic API calls server-side — your
  Anthropic API key is never exposed in the client bundle.

## 7. Children's Privacy

The App is not intended for users under 18 years of age. We do not knowingly
collect personal information from children.

## 8. Your Rights (GDPR / CCPA)

You have the right to:
- **Access**: Request a copy of your data
- **Delete**: Delete your account and all associated data
- **Port**: Export your trade journal data as CSV (via Settings)
- **Correct**: Update your profile information at any time

To exercise these rights, email: **privacy@elliottwave.pro**

## 9. Changes to This Policy

We will notify you of material changes via in-app notification or email.
Continued use of the App after changes constitutes acceptance.

## 10. Contact

**Elliott Wave Pro**
privacy@elliottwave.pro
https://elliottwave.pro/privacy
