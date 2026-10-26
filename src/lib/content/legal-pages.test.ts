import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { legalPageSchema } from './marketing-settings';

function readLegal(slug: 'terms' | 'privacy') {
  const source = readFileSync(new URL(`../../content/legal/${slug}.md`, import.meta.url), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing legal metadata: ${slug}`);
  return { data: legalPageSchema.parse(parse(match[1])), body: match[2] };
}

function section(body: string, heading: RegExp) {
  return body.split(/^##\s+/m).slice(1).find(part => heading.test(part.split(/\r?\n/, 1)[0])) ?? '';
}

describe('published legal pages match the current service', () => {
  for (const slug of ['terms', 'privacy'] as const) {
    it(`${slug} keeps its route, single page heading, update date and contact`, () => {
      const { data, body } = readLegal(slug);
      expect(data.slug).toBe(slug);
      expect(data.heading).toBe(slug === 'terms' ? 'Terms of Use' : 'Privacy Policy');
      expect(data.description).toMatch(/image/i);
      expect(data.description).toMatch(/video/i);
      expect(body).not.toMatch(/^#\s+/m);
      expect(body).toMatch(/Last updated: [A-Z][a-z]+ \d{1,2}, \d{4}/);
      expect(body).toContain('mailto:teddy920810@gmail.com');
    });
  }

  it('terms explain available media and distinguish both allowance units', () => {
    const { body } = readLegal('terms');
    expect(section(body, /services/i)).toMatch(/images[\s\S]*MP4 videos/i);
    expect(body).not.toMatch(/MVP uses demo processing|production image provider is being evaluated/i);
    const allowance = section(body, /free uses.*processing credits/i);
    expect(allowance).toMatch(/separate/i);
    expect(allowance).toMatch(/check-in/i);
    expect(allowance).toMatch(/PRO[\s\S]*refinement[\s\S]*video/i);
    expect(allowance).toMatch(/administrator/i);
  });

  it('terms distinguish preparation from a deliberate processing action and uncertain outcomes', () => {
    const { body } = readLegal('terms');
    const start = section(body, /starting/i);
    expect(start).toMatch(/automatically[\s\S]*after sign-in/i);
    expect(start).toMatch(/do not consume[\s\S]*allowance/i);
    expect(start).toMatch(/processing (?:action|button)/i);
    const status = section(body, /task status/i);
    expect(status).toMatch(/reserv/i);
    expect(status).toMatch(/confirmed[\s\S]*failures[\s\S]*return/i);
    expect(status).toMatch(/uncertain[\s\S]*duplicate/i);
    expect(status).toMatch(/existing task[\s\S]*instead of starting a duplicate/i);
    expect(status).toMatch(/unclear outcome is not an immediate refund/i);
  });

  it('privacy explains local drafts and upload preparation before removal', () => {
    const drafts = section(readLegal('privacy').body, /files and local drafts/i);
    expect(drafts).toMatch(/browser[\s\S]*draft/i);
    expect(drafts).toMatch(/automatically upload[\s\S]*sign(?:ed)? in|sign(?:ed)? in[\s\S]*automatically upload/i);
    expect(drafts).toMatch(/closing[\s\S]*does not[\s\S]*erase/i);
    expect(drafts).toMatch(/clear[\s\S]*browser|browser[\s\S]*clear/i);
  });

  it('privacy names the processing providers and scopes their retention separately', () => {
    const providers = section(readLegal('privacy').body, /processing providers/i);
    expect(providers).toMatch(/Dewatermark[\s\S]*Replicate/i);
    expect(providers).toMatch(/mask|selection/i);
    expect(providers).toMatch(/retention[\s\S]*separate|separate[\s\S]*retention/i);
    expect(providers).toContain('https://dewatermark.ai/policy');
    expect(providers).toContain('https://replicate.com/docs/topics/predictions/data-retention');
  });

  it('privacy separates temporary media from longer-lived account and recovery records', () => {
    const retention = section(readLegal('privacy').body, /retention/i);
    expect(retention).toMatch(/24 hours|one day/i);
    expect(retention).toMatch(/asynchronous|later|not[\s\S]*exact/i);
    expect(retention).toMatch(/account[\s\S]*task[\s\S]*recover/i);
    expect(retention).toMatch(/provider[\s\S]*session/i);
    expect(retention).toMatch(/longer/i);
    expect(retention).toMatch(/not[\s\S]*same automatic deletion/i);
    expect(retention).not.toMatch(/uploads, results, and processing records are designed to expire after 24 hours/i);
  });

  it('privacy covers authentication cookies, analytics, fonts and concrete deletion choices', () => {
    const { body } = readLegal('privacy');
    const google = section(body, /google sign-in/i);
    expect(google).toMatch(/openid[\s\S]*profile[\s\S]*email/i);
    expect(google).toMatch(/OAuth[\s\S]*tokens[\s\S]*are not written to our (?:profile|allowance)[^.]*database/i);
    const cookies = section(body, /cookies.*analytics/i);
    expect(cookies).toMatch(/encrypted[\s\S]*cookies|cookies[\s\S]*encrypted/i);
    expect(cookies).toMatch(/Google Analytics/);
    expect(cookies).toMatch(/Google Fonts/);
    const choices = section(body, /your choices/i);
    expect(choices).toMatch(/draft controls[\s\S]*stored drafts/i);
    expect(choices).toMatch(/Sign out using[\s\S]*site/i);
    expect(choices).toMatch(/separately[\s\S]*revoke/i);
    expect(choices).toMatch(/deletion/i);
    expect(choices).toMatch(/verify[\s\S]*identity/i);
    expect(choices).toContain('https://myaccount.google.com/connections');
  });
});
