export interface ProductSearchSource {
  id?: string;
  productId?: string;
  name?: string;
  productName?: string;
  displayName?: string;
  brand?: string;
  category?: string;
  barcode?: string;
  unit?: string;
  currentStock?: number;
  stock?: number;
}

export interface ProductSearchIndex<T extends ProductSearchSource = ProductSearchSource> {
  product: T;
  id: string;
  name: string;
  displayName: string;
  brand: string;
  category: string;
  barcode: string;
  unit: string;
  searchableText: string;
  words: string[];
  stock: number;
  sourceIndex: number;
}

export interface ProductSearchResult<T extends ProductSearchSource = ProductSearchSource> {
  product: T;
  index: ProductSearchIndex<T>;
  score: number;
}

const BANGLA_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
};

/**
 * Normalizes user-entered product search text without transliterating Bangla.
 * NFKC handles compatibility characters, Bangla digits become ASCII digits,
 * punctuation/separators become spaces, and repeated whitespace is collapsed.
 */
export function normalizeProductSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[০-৯]/g, (digit) => BANGLA_DIGITS[digit] ?? digit)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueWords(fields: string[]): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const field of fields) {
    for (const word of field.split(' ')) {
      if (!word || seen.has(word)) continue;
      seen.add(word);
      words.push(word);
    }
  }
  return words;
}

function stockOf(product: ProductSearchSource): number {
  const value = product.currentStock ?? product.stock ?? 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function createProductSearchIndex<T extends ProductSearchSource>(products: readonly T[]): ProductSearchIndex<T>[] {
  return products.map((product, sourceIndex) => {
    const name = normalizeProductSearchText(product.productName ?? product.name ?? '');
    const displayName = normalizeProductSearchText(product.displayName ?? product.name ?? product.productName ?? '');
    const brand = normalizeProductSearchText(product.brand);
    const category = normalizeProductSearchText(product.category);
    const barcode = normalizeProductSearchText(product.barcode);
    const unit = normalizeProductSearchText(product.unit);
    const fields = [displayName, name, brand, category, barcode, unit].filter(Boolean);
    return {
      product,
      id: String(product.productId ?? product.id ?? sourceIndex),
      name,
      displayName,
      brand,
      category,
      barcode,
      unit,
      searchableText: fields.join(' '),
      words: uniqueWords(fields),
      stock: stockOf(product),
      sourceIndex
    };
  });
}

function stockBonus(index: ProductSearchIndex): number {
  if (index.stock <= 0) return 0;
  // Deliberately small so stock never outranks a stronger textual match.
  return 20 + Math.min(30, Math.max(0, Math.floor(index.stock)));
}

function exactName(index: ProductSearchIndex, query: string): boolean {
  return index.displayName === query || index.name === query;
}

function nameStartsWith(index: ProductSearchIndex, query: string): boolean {
  return index.displayName.startsWith(query) || index.name.startsWith(query);
}

function allTermsMatchWordPrefix(index: ProductSearchIndex, terms: string[]): boolean {
  return terms.every((term) => index.words.some((word) => word.startsWith(term)));
}

function allTermsMatchSubstring(index: ProductSearchIndex, terms: string[]): boolean {
  return terms.every((term) => index.searchableText.includes(term));
}

function scoreNormalizedProductSearchIndex(index: ProductSearchIndex, query: string): number | null {
  if (!query) return 0;
  const terms = query.split(' ').filter(Boolean);
  const bonus = stockBonus(index);

  // Exact machine identifiers always win, regardless of stock.
  if (index.barcode && index.barcode === query) return 1_000_000 + bonus;
  if (exactName(index, query)) return 800_000 + bonus;
  if (nameStartsWith(index, query)) return 700_000 + bonus;

  if (allTermsMatchWordPrefix(index, terms)) {
    const exactWordCount = terms.filter((term) => index.words.includes(term)).length;
    return 600_000 + exactWordCount * 100 + bonus;
  }

  // Give a contiguous substring a small edge over scattered substring matches.
  if (index.searchableText.includes(query)) return 550_000 + bonus;
  if (allTermsMatchSubstring(index, terms)) return 500_000 + bonus;

  return null;
}

/** Returns null when the product does not match the query. */
export function scoreProductSearchIndex(index: ProductSearchIndex, rawQuery: unknown): number | null {
  return scoreNormalizedProductSearchIndex(index, normalizeProductSearchText(rawQuery));
}

export function searchProductIndex<T extends ProductSearchSource>(
  indexes: readonly ProductSearchIndex<T>[],
  rawQuery: unknown,
  options: { limit?: number } = {}
): ProductSearchResult<T>[] {
  const query = normalizeProductSearchText(rawQuery);
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : Number.POSITIVE_INFINITY;

  if (!query) {
    return indexes.slice(0, limit).map((index) => ({ product: index.product, index, score: 0 }));
  }

  return indexes
    .map((index) => ({ product: index.product, index, score: scoreNormalizedProductSearchIndex(index, query) }))
    .filter((result): result is ProductSearchResult<T> => result.score !== null)
    .sort((a, b) => (b.score - a.score) || (a.index.sourceIndex - b.index.sourceIndex))
    .slice(0, limit);
}

export function findExactBarcodeMatch<T extends ProductSearchSource>(
  indexes: readonly ProductSearchIndex<T>[],
  rawQuery: unknown
): T | undefined {
  const query = normalizeProductSearchText(rawQuery);
  if (!query) return undefined;
  return indexes.find((index) => Boolean(index.barcode) && index.barcode === query)?.product;
}

export function getProductSearchLabel(product: ProductSearchSource): string {
  return String(product.displayName ?? product.name ?? product.productName ?? product.productId ?? product.id ?? '').trim();
}
