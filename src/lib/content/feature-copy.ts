export interface FeatureCopy {
  description: string;
  listItems?: readonly string[];
}

export function splitFeatureCopy(description: string, listItems: readonly string[] = []) {
  const explicitItems = listItems.map((item) => item.trim()).filter(Boolean);
  const parts = description.split(/[•·]/).map((part) => part.trim()).filter(Boolean);

  return {
    description: parts[0] ?? description.trim(),
    listItems: explicitItems.length > 0 ? explicitItems : parts.slice(1),
  };
}
