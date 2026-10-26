---
slug: privacy
title: Privacy Policy | WatermarkGemini
description: How WatermarkGemini handles Google account information, image and video files, local drafts, processing records, cookies and analytics.
eyebrow: Privacy
heading: How WatermarkGemini handles your data
---

Last updated: October 26, 2026

This policy explains what WatermarkGemini collects, why it is used, how long it is kept and the choices available to you. It covers our website, Google sign-in, and image and video tools. Our [Terms of Use](/terms) explain permitted use and processing allowances.

## Google sign-in and account information

With your authorization, Google may provide a stable account identifier, email and verification status, display name, given and family names, profile-image address, language or locale, and Google Workspace domain where available. We store these details to authenticate you, display your account, keep your account ownership stable, maintain allowances and check-ins, prevent abuse and provide support.

We request the `openid`, `profile` and `email` scopes. This does not give the service access to your Google contacts, Drive files, mailbox or calendar. Google OAuth access tokens, refresh tokens and ID tokens are not written to our profile or allowance-history database; encrypted authentication cookies may hold account and sign-in data needed to maintain your login.

We do not sell your Google account information or add your Google profile or email address to our analytics events.

## Files and local drafts

Anonymous selection and preview happen in your browser. The browser can store selected image or video files, names, previews and recovery information as local drafts. The workspace stops restoring drafts after one hour; removal from browser storage depends on later browser activity. Closing a tab does not immediately erase stored drafts, and signing out is not a guarantee that every local copy has been removed. Use the discard controls where available or clear this site's browser data, especially on a shared device.

When you are signed in, the watermark workspaces can automatically upload your selected file for validation and quoting before you click the processing button. Background and object tools upload when you request their processing action, including continuing that request after sign-in. The preparation and removal stages are described in our Terms of Use.

Uploaded images, videos, selection masks and results use private storage. We also handle technical media details, operation and task identifiers, status, timestamps, provider references and allowance transactions to perform and recover tasks. Videos may contain audio; media you send may itself contain personal information. Upload only material you have permission to share, and avoid confidential or sensitive files.

## Processing providers and infrastructure

- **Dewatermark** receives image or video content for watermark removal. Refinement or fixed-area operations may also send selection masks and processing-session references. See [Dewatermark's policy](https://dewatermark.ai/policy).
- **Replicate** handles background removal using the 851 Labs model and object removal using LaMa. It receives temporary links to the image and, for object removal, the selection mask. Its [API data-retention documentation](https://replicate.com/docs/topics/predictions/data-retention) describes default removal of prediction inputs, outputs, files and logs after one hour.
- **Vercel, Cloudflare R2, Google Cloud and Neon** provide hosting, private storage, task execution and database services. Google also provides authentication, analytics and fonts as described below.

Processing requests do not separately include your Google profile. Providers still receive the media and technical request data needed for their role. Provider retention practices are separate from ours: our temporary-file policy does not guarantee identical deletion times at every provider. These services may process data in countries other than yours under their applicable terms and policies.

## Retention

**Temporary media:** uploaded files, masks and results are generally scheduled for expiry after about 24 hours in our storage. Workspaces show the applicable access deadline; temporary links expire sooner. A result's available period can be shorter than 24 hours after completion. Storage deletion is asynchronous and may occur later than the scheduled expiry, rather than at an exact 24-hour instant. [Cloudflare describes this cleanup behavior](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

**Account and service records:** Google account details, allowance and check-in history, task and quote records, recovery data, and provider references may be kept longer to operate accounts, reconcile tasks and allowances, investigate issues, prevent abuse and meet applicable obligations. Processing metadata, including selections and provider session identifiers, can remain in those records after media expires. These records do not follow the same automatic deletion schedule as temporary media.

**Local copies and provider copies:** browser drafts, files you download and copies handled by processing providers have separate lifetimes. Revoking Google access or signing out does not automatically erase records already held by us or third parties. Contact us about records you want reviewed or deleted.

## Cookies, analytics and technical data

Authentication uses encrypted cookies to keep you signed in. Browser storage also supports draft and task recovery. Blocking or clearing these mechanisms can sign you out or remove recovery information.

Public pages use Google Analytics to measure site usage independently of whether you sign in. It can use cookies or similar identifiers and receive page visits, referrers, approximate location and device/browser information. Our application does not send uploaded media or Google profile fields as analytics-event data. Browser privacy settings and content-blocking tools can limit collection; [Google explains Analytics cookies](https://support.google.com/analytics/answer/11397207).

Pages also load Google Fonts directly, so your browser makes requests to Google. Hosting, authentication, font and security requests may include IP address, browser information, request time and referrer information. See [Google's Privacy Policy](https://policies.google.com/privacy) for its handling of this data.

We use technical logs to maintain reliability, diagnose problems and protect the service. If you email us, we also receive the information you choose to send. Information may be disclosed when reasonably necessary to investigate abuse, protect users or respond to a legal obligation. We do not sell personal information.

## Security

OAuth client secrets, storage credentials and processing-provider API keys stay in server-side systems. Authentication cookies are distinct from those service secrets. Media access uses private storage, authenticated requests and temporary links; treat any temporary link as sensitive. No online service can guarantee absolute security.

## Your choices

- Use the available draft controls to remove stored drafts. Clearing this site's cookies and storage also removes authentication and recovery data. Files you have downloaded are separate copies on your device; keep any result you need before its expiry.
- Sign out using this site's controls. You can separately revoke future Google authorization through your [Google Account connections page](https://myaccount.google.com/connections). These actions are separate from requesting deletion of existing service records.
- Use browser privacy controls or content-blocking tools to limit analytics and third-party requests.
- Contact us to request access to, correction of or deletion of personal information we hold. We may need to verify your identity and explain any records that must be retained for unresolved tasks, security or applicable obligations.

## Contact

For privacy questions or data requests, email [teddy920810@gmail.com](mailto:teddy920810@gmail.com). Do not send passwords, authentication cookies, API keys or private access links in ordinary email.

## Changes to this policy

We may update this policy as the service or its data practices change and will show the updated date here. Material changes to the use of Google account data will be disclosed before the new use, with consent requested where required.
