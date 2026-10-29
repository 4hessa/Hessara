import catalog from './catalog/models.json';
import { createCatalogSnapshot } from './advisor';

// Stable, source-dated facts. Opening the advisor never implies a fresh check.
export const advisorSnapshot = createCatalogSnapshot(catalog);
