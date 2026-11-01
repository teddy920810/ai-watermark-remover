# App workspace and staged operation adapters

Status: P4–P6 locally verified; P7 retirement and verification belong to the refactor ledger. Deployment, real OAuth and Provider acceptance remain pending.

`/app` renders the product entry. `/app/image` and `/app/video` use the same `AppWorkspaceLayout`, `AppWorkspace` and `AppShell`; they remain compatible draft/task links. Static HTML contains only public branding/copy and a readable loading/reload/no-JavaScript explanation. Private files, balances, quotes and tasks are loaded after authentication. The interactive workspace loads as a chunk and a failed load leaves a reload action.

`AppShell` owns navigation, account presentation, operation selection and the layout. `WatermarkWorkspace` retains one durable coordinator for all six operations. `ObjectMaskEditor` keeps object-specific selection policy separate from refinement; `BackgroundOptions` keeps local color compositing. Vendor requests, price consent, server ownership and financial settlement retain their operation contracts. Refinement remains an action on a supported completed result; an arbitrary original cannot request refinement through a query parameter.

| State | Action and transition | Invariant |
| --- | --- | --- |
| Loading or chunk failure | Explain/reload the same URL | No private data in the static shell; reload does not create a processing request |
| Anonymous local file | Preview the file, choose a compatible operation, sign in | Local draft only; intake does not upload or charge |
| Initial sign-in | Keep the mounted editor and its explicitly accepted state | A session refresh must not discard the original file or selection; unquoted sign-in is not processing consent |
| Authenticated durable preparation | Restore/upload/inspect the same owned source and selection | Non-billable preparation; late file/selection/account responses cannot replace current state |
| Valid durable quote | Show amount, unit, balance and output, then require the processing button | File/operation/selection/expiry changes invalidate the quote; three balances stay separate |
| Unconfirmed durable submission | Check the original quote and key | Do not replace its key or create a fresh paid replay |
| Accepted durable task | Restore its deep link or Recent work; refresh status | The accepted task determines media type ahead of a new operation hint; CAS/lease/outbox/unknown/late-result rules stay server-owned |
| Completed durable result | Compare/download real bytes and use supported refinement/versions | Original result/session/PRO constraints and artifact metadata remain intact |
| Durable background | Prepare/quote in the common coordinator, then require explicit confirmation | Preserve original-size transparent PNG and local color-composited PNG; never spend administrator credits |
| Durable object | Bind source/mask to the current quote and confirm explicitly | Preserve brush/lasso/eraser, twenty snapshots and opaque binary masks; original-size PNG, free/purchased balances only |
| Account change | Unmount private state, clear App pointers and restore only eligible drafts | Authenticated drafts carry an owner; another owner or anonymous state cannot restore them |

Unowned drafts remain anonymous handoffs for compatibility and can be claimed on initial sign-in. The claim preserves the file and its identifier rather than replacing a mounted editor. Account metadata in IndexedDB is a UI isolation rule, not a security boundary; every private upload/task/download is still authorized by the server. Existing ownerless records cannot retroactively establish an earlier identity and retain their original one-hour expiry.

Image-operation switches retain the current source in the mounted coordinator and invalidate the old quote/selection. Accepted and UNKNOWN tasks remain locked to their original identity. A media-type switch saves the original local handoff, or reopens the current owner's original artifact before navigation; failure keeps the current state and reports an error. Old JobService admission/query/download APIs and their existing records remain compatible until real acceptance and exit windows are established.

The operation selector owns Standard/PRO selection; its explanatory text keeps purchased image credits separate from administrator processing credits. Current operation actions and output labels are code-owned. CMS can supply public content copy but cannot choose the upload API, Provider, operation implementation or price.

`design-system.css` owns shared primitives. `workspace.css` and `image-editor.css` own App/editor presentation. Image output and object-selection controls use the `.workspace-image-options` scope. Their image and canvas planes preserve the source aspect ratio, including portrait images; an inherited height cap must not stretch the mask independently of the displayed source. Public pages hand files to App. Zero-consumer legacy editors, their old price/read helpers and synthetic comparison components are retired; old APIs and retained client assets remain compatible. `MediaLauncher` and its styles select both Web targets. [File intake](./FILE_INTAKE.md) describes replacement/drop and recommendation policy.

Google sign-in retains the existing initializer object and callback behavior. Primary vendor reference: [Better Auth Google](https://better-auth.com/docs/authentication/google). Browser fixtures simulate session completion and verify price/file retention; they do not confirm a real OAuth flow. Production authenticated processing and per-operation smoke require the later authorized deployment and explicit paid-operation budget.
