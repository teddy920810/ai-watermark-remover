interface PageSchemaInput {
  canonicalOrigin: string;
  path: string;
  name: string;
  description: string;
}

interface ArticleSchemaInput {
  canonicalOrigin: string;
  path: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
  publisherName: string;
  logo: string;
  image?: string;
}

function absoluteUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}

export function buildCollectionPageSchema(input: PageSchemaInput) {
  return {
    '@type': 'CollectionPage',
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.canonicalOrigin, input.path),
  };
}

export function buildWebPageSchema(input: PageSchemaInput) {
  return {
    '@type': 'WebPage',
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.canonicalOrigin, input.path),
  };
}

export function buildArticleSchema(input: ArticleSchemaInput) {
  const url = absoluteUrl(input.canonicalOrigin, input.path);
  return {
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    ...(input.image ? { image: absoluteUrl(input.canonicalOrigin, input.image) } : {}),
    author: { '@type': 'Organization', name: input.author },
    publisher: {
      '@type': 'Organization',
      name: input.publisherName,
      url: input.canonicalOrigin,
      logo: { '@type': 'ImageObject', url: absoluteUrl(input.canonicalOrigin, input.logo) },
    },
  };
}
