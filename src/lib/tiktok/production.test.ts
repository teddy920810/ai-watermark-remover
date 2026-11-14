import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { createTikTokAdmission } from './admission';
import { linkToolWorkspaceForSource } from '../contracts/route-policy.mjs';

it('exposes the existing TikTok landing entry in production', () => {
  expect(linkToolWorkspaceForSource('/tiktok-watermark-remover')).toBe('/app/free/tiktok');
});

it('shares one expiring admission lease and daily budget across server instances', async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync('db/migrations/012_tiktok_admission.sql', 'utf8'));
    const first = createTikTokAdmission(db), second = createTikTokAdmission(db);
    const lease = await first.acquire();
    expect(lease).toBeTruthy();
    expect(await second.acquire()).toBeNull();
    await first.release(lease!);
    expect(await second.acquire()).toBeNull(); // spacing also survives release
    await db.exec("UPDATE tiktok_admission SET next_start = now() - interval '1 second'");
    const next = await second.acquire();
    expect(next).toBeTruthy();
    await first.release(lease!); // an old request cannot release a newer lease
    expect(await first.acquire()).toBeNull();
    await db.exec("UPDATE tiktok_admission SET active_until = now() - interval '1 second', next_start = now() - interval '1 second', daily_count = 500");
    expect(await first.acquire()).toBeNull();
    await db.exec("UPDATE tiktok_admission SET day_start = now() - interval '1 day'");
    expect(await first.acquire()).toBeTruthy();
    expect((await db.query<{ daily_count: number }>('SELECT daily_count FROM tiktok_admission')).rows[0].daily_count).toBe(1);
  } finally { await db.close(); }
});
