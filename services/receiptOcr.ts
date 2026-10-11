import { api, uploadImage, type OcrReceipt } from '@/src/api/client';
import type { CategoryId, PostPolarity, ReceiptData } from '@/types';

interface ScanReceiptParams {
  /** Локален URI на снимката — качва се и се разчита от сървъра. */
  imageUri: string;
  /** Публичен адрес, ако вече е качен. */
  imageUrl?: string;
  category: Exclude<CategoryId, 'all'>;
  polarity: PostPolarity;
}

export interface ScanReceiptResult extends ReceiptData {
  model?: string;
}

/**
 * Реален OCR през сървъра (OpenRouter vision модел).
 *
 * Промяна спрямо старата версия: НЯМА измислени „примерни“ бележки.
 * Ако OCR не е конфигуриран или не успее, функцията хвърля грешка и UI-ът
 * показва честно съобщение — вместо да попълни формата с фалшив търговец,
 * фалшив ЕИК и фалшива сума.
 */
export async function analyzeReceiptImage({
  imageUri,
  imageUrl,
  category,
  polarity,
}: ScanReceiptParams): Promise<ScanReceiptResult> {
  const url = imageUrl ?? (imageUri.startsWith('http') ? imageUri : await uploadImage(imageUri));

  const { receipt } = await api.ocrReceipt({
    imageUrl: url,
    categoryHint: category,
    polarityHint: polarity,
  });

  return mapOcrReceipt(receipt, imageUri);
}

function mapOcrReceipt(receipt: OcrReceipt, imageUri: string): ScanReceiptResult {
  return {
    merchantName: receipt.merchantName,
    merchantTaxId: receipt.merchantTaxId,
    date: receipt.date,
    totalAmount: receipt.totalAmount,
    time: receipt.time,
    currency: receipt.currency,
    verifiedByAi: true,
    confidenceScore: receipt.confidenceScore,
    receiptImageUri: imageUri,
    items: receipt.items,
    model: receipt.model,
  };
}
