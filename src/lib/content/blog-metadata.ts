interface BlogMetadataInput {
  title: string;
  author?: string;
  category?: string;
}

interface BlogMetadataDefaults {
  author: string;
  category: string;
}

export function resolveBlogMetadata(
  post: BlogMetadataInput,
  defaults: BlogMetadataDefaults,
  siteName: string,
) {
  return {
    title: `${post.title} | ${siteName}`,
    author: post.author ?? defaults.author,
    category: post.category ?? defaults.category,
  };
}
