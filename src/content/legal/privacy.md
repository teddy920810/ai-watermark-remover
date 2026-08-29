---
slug: privacy
title: Privacy Policy | WatermarkGemini
description: How WatermarkGemini handles Google account details, uploaded images, processing data, and analytics.
eyebrow: Privacy
heading: How WatermarkGemini handles your data
---

Last updated: August 29, 2026

This policy explains what WatermarkGemini collects, why it is used, how long it is kept, and the choices available to you. It applies when you visit the website, sign in with Google, or use the image-processing service.

## Google sign-in and account information

You may select and preview an image without signing in. Google sign-in is required when you start processing an image.

With your authorization, Google may provide WatermarkGemini with your stable Google account identifier, email address, email verification status, display name, given name, family name, profile image, language or locale, and Google Workspace hosted domain when those fields are available. Google does not always provide every optional field.

WatermarkGemini uses this information to authenticate you, maintain your signed-in session, display your account, associate free-use balances and check-ins with the correct user, prevent abuse, secure the service, and provide account or service support. It is not used to read your Google contacts, Drive files, emails, calendar, or other Google services. WatermarkGemini requests only the `openid`, `profile`, and `email` scopes and does not store Google OAuth access tokens, refresh tokens, or ID tokens in its profile database.

We do not sell Google account information or use it for personalized advertising. We will not use it for a materially different purpose without first updating this policy and, where required, asking for your consent.

## Uploaded images and processing data

WatermarkGemini processes the image you choose to upload so it can return a result. Uploads, results, and processing records are stored in private object storage rather than exposed through permanent public URLs. Short-lived signed links may be used to upload, process, or download those files.

Images and the minimum related processing data may be handled by infrastructure and image-processing providers only as needed to operate the requested service. Do not upload confidential images or images you do not own or have permission to edit.

For background removal, WatermarkGemini sends a short-lived signed link to your uploaded image to Replicate, which runs the 851 Labs background-removal model. Replicate API prediction inputs, outputs, and related prediction data are automatically removed after one hour under Replicate's current API retention policy. WatermarkGemini does not send your Google profile information to Replicate for image processing.

## Retention

Uploads, results, and processing records are designed to expire after 24 hours. Temporary signed access links expire sooner.

Google profile information and service records such as free-use balances, check-ins, and processing-credit history are retained while needed to operate the account, maintain security and abuse controls, and meet applicable operational or legal obligations. Revoking Google access prevents future authorization but does not automatically delete information already stored by WatermarkGemini.

## Analytics and technical data

Basic hosting and security logs may process information such as IP address, request time, browser or device details, and requested pages for reliability, fraud prevention, and security.

WatermarkGemini uses Google Analytics to understand aggregate site usage. Depending on your consent and browser settings, analytics may process page visits, referrer, approximate location, device details, and cookie or similar identifiers. Analytics data is not combined with the Google profile table for personalized advertising.

## Service providers and disclosure

WatermarkGemini relies on service providers for Google authentication, website hosting, managed databases, private object storage, analytics, and image processing, including Replicate for the background-removal feature. They may process data only to provide those services under their applicable terms and safeguards.

Information may also be disclosed when reasonably necessary to protect users or the service, investigate abuse, comply with law, or respond to a valid legal request. WatermarkGemini does not sell personal information.

## Security

Google credentials and service secrets are kept in server-side systems and are not sent to browser code. Uploaded images are kept in private storage, and access is limited through expiring links and authenticated service requests. No online service can guarantee absolute security, but WatermarkGemini uses reasonable technical and organizational safeguards appropriate to the service.

## Your choices

You may close the page before uploading to keep the file on your device. You can sign out, revoke WatermarkGemini's access from your [Google Account connections page](https://myaccount.google.com/connections), and limit analytics through browser privacy controls, cookie settings, consent controls, or content-blocking tools.

You may request access to, correction of, or deletion of profile information stored by WatermarkGemini. We may need to verify your identity before completing a request.

## Contact

For privacy questions or requests concerning your personal information, email [teddy920810@gmail.com](mailto:teddy920810@gmail.com).

## Changes to this policy

This policy may be updated when the service or its data practices change. Material changes to the way Google user data is used will be disclosed before the new use begins, and consent will be requested when required.
