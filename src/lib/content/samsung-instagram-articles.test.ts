import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const articles = [
  {
    "name": "samsung",
    "slug": "how-to-remove-samsung-watermark-from-photos",
    "title": "How to Remove Samsung Watermark from Photos: 4 Easy Ways",
    "seoTitle": "How to Remove Samsung Watermark from Photos (4 Easy Ways)",
    "description": "Learn how to remove Samsung watermarks from existing photos online, with Galaxy Gallery, or by cropping, and turn off watermarks for future shots.",
    "h2": 11,
    "h3": 13,
    "tables": 2,
    "images": [
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-1.jpg",
        "hash": "d30e60c5609ceba171bd3a9012aa81e9073898ca46f0bc43afe454ef40fb47fe"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-2.jpg",
        "hash": "f6914a4b2ae669ca5c9a3a979693b0e038f07a1a8e4e028e26359bff63f32610"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-3.jpg",
        "hash": "a7ce4005b4f3806c752cc42660359baff52c0b34c0bdb010eb7958d7e07db194"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-4.jpg",
        "hash": "ddfd6f59300f61d487257b20c313677d1b1ba5f5d5032e86427971d7cb0bc2be"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-5.jpg",
        "hash": "1d138a84ed3a8c4503199e3a3361cdc6784ae87571522261f439099ccc144f34"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-6.jpg",
        "hash": "74ba3fc9b254cf380c0cf27ecb4b53d40566fc080245968a11e40ea73ed5d371"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-7.jpg",
        "hash": "eb6154d1ab94c628cd3a564982ae82fc7e0e2c98deb26a0a616325c43a56a665"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-8.jpg",
        "hash": "fd3640e8e7187b60ac98eb0b1c3b4c3ca6cdcd70a0fe3121c02ae96f83546342"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-9.jpg",
        "hash": "50f17dac4da52d9109135379b886ec3b80455bac9f328a24421fca6685d52d9b"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-10.jpg",
        "hash": "c2fc6c3bdab915fdc4dc57ec29ee0c66c83f57099fbcb3abf4dfef977c5a748c"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-11.jpg",
        "hash": "5754a3c368feda88ca3397dfcd09e42484086d02734896a9008627efc4792265"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-12.jpg",
        "hash": "230e036b52bcecdd2c0e951e7c5635cde2e68d62c0dc6a76962f0237e239466d"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-13.jpg",
        "hash": "6ab5723cf7650cea7c3213e1ac927daad5433a7b648e354512a382ac7148bcf4"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-14.jpg",
        "hash": "12876c7b6995ac2ffa9a452e11cb843a9ad8bba06facb8bd2c307dea97634b87"
      },
      {
        "filename": "how-to-remove-samsung-watermark-from-photos-figure-15.jpg",
        "hash": "0801fae792afa068c87e410bed955451be43fc4b6f145fd5b5fa4d837da8617b"
      }
    ],
    "links": [
      "https://www.watermarkgemini.com/",
      "https://www.samsung.com/in/support/mobile-devices/how-to-use-your-galaxy-camera-to-add-and-edit-a-watermark-for-your-photos/",
      "https://www.samsung.com/us/support/answer/ANS10004543/",
      "https://www.samsung.com/us/support/answer/ANS10000934/",
      "https://www.watermarkgemini.com/terms"
    ]
  },
  {
    "name": "instagram",
    "slug": "how-to-remove-instagram-watermark",
    "title": "How to Remove Instagram Watermark from Reels and Videos (4 Ways)",
    "seoTitle": "How to Remove Instagram Watermark from Reels & Videos (2026)",
    "description": "Learn how to remove Instagram watermarks from downloaded Reels and videos using AI, original exports, and free alternatives. Compare 4 easy methods.",
    "h2": 8,
    "h3": 17,
    "tables": 1,
    "images": [
      {
        "filename": "how-to-remove-instagram-watermark-figure-1.jpg",
        "hash": "98dfdd663f02026e895527a16979b670fa97573de0a87fb615f93654db9b126c"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-2.jpg",
        "hash": "2f76a4a949653810feef0cd2653ec6d6626ef071ecfccaab8fa6f6ad67806528"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-3.jpg",
        "hash": "9a079794df640a5a80e9579337381db35e1987c82e53f5e7bd5debbec1b9f499"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-4.jpg",
        "hash": "6b19ade243d1c63ce6851d5fc006a9768fd48bfaab424e181097884a8ce44034"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-5.jpg",
        "hash": "44e00ad8e6c99c78ac0dde686a7b4362cfc3fe0711c8dd15b44c51b54ce9bbd4"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-6.jpg",
        "hash": "9eea982b152fa3169edbab4b7b431cd0dc28185dabc2d0cdd3ce253a8f0ee18a"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-7.jpg",
        "hash": "5df6d6add6920970985bb468307ae55e211c5b0880e6b4cf942bb64c93a56059"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-8.jpg",
        "hash": "ce2d54a299a8d4e18ac78eed6c8e5fc84eb3bfe4256ef43bff8bb091ba72912a"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-9.jpg",
        "hash": "cb8bf9a7de78af564116c07ebd22ede146a8960a40adcb15d6e4d6f83b674ecb"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-10.jpg",
        "hash": "3a75f18c8e76fef722c6e343cbfa1e3c6693c5ef03eff9a2e7f8e33be3afb013"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-11.jpg",
        "hash": "476943b7e40c091acd432adf166855ec3de12b6e108c084edc28e91ebe6a7e58"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-12.jpg",
        "hash": "1ee99cf6f7c8657b25bff89444a3449ef12aa13f7b7da305b22f83deb105095a"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-13.jpg",
        "hash": "924f39e00b874eed2e7ba46d86a653a0c3c455efb0551ec2ad193c8ee1c3173b"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-14.jpg",
        "hash": "15cbb326a47fb35dd03c47d6a4c85c12bb53af7896205ae55c123ba7621922ad"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-15.jpg",
        "hash": "67439b6e656de761155395a53715a02bd4ca68087fba3d2cf54c713d97763ec3"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-16.jpg",
        "hash": "d0216c7c0f3302bbccba694524b5768b1e4d97b5a61d8a63ae71a3bc8dc7413f"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-17.jpg",
        "hash": "cdbb964cc5da4ffb5a1fb95982a6c818e6a0b1887376e91fe604b2042b34b265"
      },
      {
        "filename": "how-to-remove-instagram-watermark-figure-18.jpg",
        "hash": "c744eb15442ed39fcf0ac173e733d0032e4b284717b35647542db2ed7157b4a2"
      }
    ],
    "links": [
      "https://www.watermarkgemini.com/video-watermark-remover",
      "https://www.facebook.com/help/instagram/520831036611383",
      "https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/",
      "https://www.facebook.com/help/354736791367645/"
    ]
  }
];

describe('Samsung and Instagram operations articles', () => {
  it.each(articles)('publishes $slug with complete structure and supplied SEO metadata', (article) => {
    const source = fs.readFileSync('src/content/blog/' + article.slug + '.md', 'utf8');
    const [, frontmatter, body] = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)!;
    expect(YAML.parse(frontmatter)).toMatchObject({
      slug: article.slug, title: article.title, seoTitle: article.seoTitle,
      description: article.description, publishedAt: '2026-10-25', draft: false,
      contentMode: 'markdown', coverImage: '/uploads/' + article.images[0].filename,
    });
    expect(body).not.toMatch(/^# /m);
    expect(body.match(/^## /gm)).toHaveLength(article.h2);
    expect(body.match(/^### /gm)).toHaveLength(article.h3);
    expect(body.match(/^\| (?:---\s*\|\s*)+$/gm)).toHaveLength(article.tables);
    expect(body).not.toMatch(/SEO PUBLISHING INFORMATION|PUBLISHABLE ENGLISH ARTICLE|PRE-PUBLICATION CHECKLIST|Source verification & original-asset handoff|Screenshot 1|Evidence log|Editorial ownership/);
    expect(body).not.toMatch(/^(?:SEO Title|Meta Description|URL Slug|Focus Keyword):/m);
    expect(body).toContain('Illustrations in this guide are examples, not live product screenshots or verified processing results.');
    const images = [...body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    expect(images).toHaveLength(article.images.length - 1);
    for (const [index, image] of images.entries()) {
      expect(image[1].trim()).not.toBe('');
      expect(image[2]).toBe('/uploads/' + article.images[index + 1].filename);
    }
    for (const link of article.links) expect(body).toContain(link);
    if (article.name === 'instagram') {
      expect(body).toContain('administrator-allocated credits');
      expect(body).toContain('does not support moving-watermark tracking');
      expect(body).toContain('not claims of completed WatermarkGemini tests');
      expect(body).not.toContain('https://www.watermarkgemini.com/instagram-watermark-remover');
      expect(body).toContain('Alpine lake travel Reel scene with a simulated blurred patch covering a corner username mark.');
    } else {
      expect(body).toContain('demo processing may return an unchanged copy');
      expect(body).toContain('Turning off the camera option does not rewrite an exported photo.');
    }
  });

  it.each(articles)('preserves every placed source image for $slug without orphan media', (article) => {
    for (const image of article.images) {
      const buffer = fs.readFileSync('public/uploads/' + image.filename);
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(image.hash);
    }
    const files = fs.readdirSync('public/uploads').filter(file => file.startsWith(article.slug + '-figure-'));
    expect(files).toHaveLength(article.images.length);
  });
});
