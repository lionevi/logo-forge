/** Déclarations de l'intégration des éléments de marque. */

export const MARKER: string
export const BRAND_FILES: Record<string, string>

export function prepareSvg(source: string): { markup: string | null; reason: string }
export function collectBrand(assetsDir: string): {
  brand: Record<string, string>
  notes: string[]
}
export function inlineBrand(html: string, brand: Record<string, string>): string
