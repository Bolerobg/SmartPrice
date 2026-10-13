import { CATEGORIES } from '@/constants/theme';
import { PostItem } from '@/types';

export type SortMode = 'newest' | 'best_savings' | 'lowest_price' | 'highest_price' | 'most_helped';

/**
 * Умно търсене по абсолютно всички полета на публикацията:
 * заглавие, описание, обект, град, категория, платформа, цена, тагове,
 * автор, артикули от касовата бележка и коментари.
 * Поддържа многодумови заявки (напр. "вода созопол" или "кафе софия").
 */
export function matchesUniversalSearch(post: PostItem, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const categoryInfo = CATEGORIES.find((c) => c.id === post.category);
  const receiptItemsText =
    post.receipt?.items
      .map((i) => `${i.name} ${i.highlightReason || ''} ${i.totalPrice}`)
      .join(' ') || '';
  const commentsText =
    post.comments.map((c) => `${c.text} ${c.authorName}`).join(' ') || '';

  const searchableBlob = [
    post.title,
    post.description,
    // ID на офертата — търси се и по „SP-7K2M4Q“, и по „7k2m4“ (без тирета)
    post.code || '',
    (post.code || '').replace(/-/g, ''),
    post.placeName,
    post.city,
    post.address || '',
    post.platformTag,
    post.customPlatformLabel || '',
    post.customCategoryLabel || '',
    post.sellerNote || '',
    post.sellerContact || '',
    categoryInfo?.label || '',
    categoryInfo?.shortLabel || '',
    String(post.pricePaid),
    post.pricePaid.toFixed(2),
    post.referencePrice ? String(post.referencePrice) : '',
    post.tags.join(' '),
    post.author.name,
    post.author.handle,
    post.receipt?.merchantName || '',
    post.receipt?.verifiedByAi ? 'бележка доказано бон' : '',
    receiptItemsText,
    commentsText,
    post.polarity === 'green'
      ? 'оферта находка евтино изгодно намаление промоция'
      : 'червен флаг капан скъпо измама обир не ходи такса',
  ]
    .join(' ')
    .toLowerCase();

  const words = q.split(/\s+/).filter(Boolean);
  // Ако човекът търси по код (напр. „SP-7K2M4“ или „7k2m4“), тиретата се махат.
  const compactQuery = q.replace(/[^a-z0-9]/g, '');
  const looksLikeCode = compactQuery.length >= 4 && /^(sp)?[a-z0-9]{3,12}$/.test(compactQuery);
  if (looksLikeCode && searchableBlob.replace(/-/g, '').includes(compactQuery)) return true;

  return words.every((word) => searchableBlob.includes(word));
}

export function sortPostsSmart(posts: PostItem[], sortMode: SortMode): PostItem[] {
  const copy = [...posts];
  switch (sortMode) {
    case 'lowest_price':
      return copy.sort((a, b) => a.pricePaid - b.pricePaid);
    case 'highest_price':
      return copy.sort((a, b) => b.pricePaid - a.pricePaid);
    case 'best_savings':
      return copy.sort((a, b) => {
        const diffA = a.referencePrice ? Math.abs(a.referencePrice - a.pricePaid) : 0;
        const diffB = b.referencePrice ? Math.abs(b.referencePrice - b.pricePaid) : 0;
        return diffB - diffA;
      });
    case 'most_helped':
      return copy.sort((a, b) => b.helpedCount - a.helpedCount);
    case 'newest':
    default:
      return copy;
  }
}
