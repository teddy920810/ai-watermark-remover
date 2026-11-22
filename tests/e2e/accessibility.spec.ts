import { testPublicAccessibility } from './support/public-page';

// Register the two halves in distant specs so Playwright can balance both CI shards.
testPublicAccessibility('odd');
