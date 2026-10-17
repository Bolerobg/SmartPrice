/**
 * Превръща редовете от базата в точните форми, които мобилното приложение
 * вече очаква (types/index.ts). Така UI-ът и структурата остават непроменени —
 * сменя се само източникът на данни.
 */

export const CURRENCY_LABEL: Record<string, string> = {
  BGN: 'лв.',
  EUR: '€',
};

export function currencyLabel(code: string): string {
  return CURRENCY_LABEL[code] ?? code;
}

export interface ReceiptRow {
  id: string;
  post_id: string;
  merchant_name: string;
  merchant_tax_id: string | null;
  receipt_date: string | null;
  receipt_time: string | null;
  total_amount: number;
  currency: string;
  confidence: number;
  verified_by_ai: boolean;
  source: string;
  model: string | null;
  image_url: string | null;
}

export interface ReceiptItemRow {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  highlight_reason: string | null;
}

export interface PostRow {
  id: string;
  public_code: string;
  author_id: string;
  /** Откъде идва цената (миграция 020): user | receipt_basket | brochure | … */
  source?: string | null;
  source_note?: string | null;
  source_url?: string | null;
  polarity: 'green' | 'red';
  category: string;
  custom_category_label: string | null;
  platform_tag: string;
  custom_platform_label: string | null;
  title: string;
  description: string;
  place_name: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  location_auto_detected: boolean;
  price_paid: number;
  reference_price: number | null;
  currency: string;
  unit_quantity: number | null;
  unit_type: string | null;
  price_per_unit: number | null;
  is_shrinkflation: boolean;
  is_fake_promo: boolean;
  image_url: string;
  comparison_image_url: string | null;
  comparison_label: string | null;
  seller_type: 'business' | 'private';
  seller_note: string | null;
  seller_contact: string | null;
  verified_valid_today_count: number;
  last_verified_at: Date | string | null;
  helped_count: number;
  signal_count?: number;
  community_saved_bgn: number;
  tags: string[];
  created_at: Date | string;
  author: {
    id: string;
    name: string;
    handle: string;
    avatar: string | null;
    isSupporter: boolean;
    badgeTitle: string;
  };
  reactions: Record<string, number>;
  comments_count: number;
}

export interface PriceHistoryRow {
  id: string;
  post_id: string;
  price: number;
  status: 'initial' | 'confirmed' | 'changed';
  reported_by: string | null;
  reporter_name: string | null;
  created_at: Date | string;
}

export interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  image_url: string | null;
  reported_price: number | null;
  likes_count: number;
  created_at: Date | string;
  author_name: string;
  author_handle: string;
  author_avatar: string | null;
  author_is_supporter: boolean;
}

const iso = (v: Date | string | null | undefined): string =>
  v == null ? new Date().toISOString() : v instanceof Date ? v.toISOString() : v;

export function mapReceipt(
  receipt: ReceiptRow | null | undefined,
  items: ReceiptItemRow[],
  receiptImageUrl?: string | null
) {
  if (!receipt) return undefined;
  return {
    merchantName: receipt.merchant_name,
    merchantTaxId: receipt.merchant_tax_id ?? undefined,
    date: receipt.receipt_date ?? '',
    time: receipt.receipt_time ?? undefined,
    totalAmount: receipt.total_amount,
    currency: currencyLabel(receipt.currency),
    verifiedByAi: receipt.verified_by_ai,
    confidenceScore: receipt.confidence,
    receiptImageUri: receiptImageUrl ?? receipt.image_url ?? undefined,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      totalPrice: i.total_price,
      highlightReason: i.highlight_reason ?? undefined,
    })),
  };
}

export function mapPost(params: {
  post: PostRow;
  priceHistory?: PriceHistoryRow[];
  receipt?: ReceiptRow | null;
  receiptItems?: ReceiptItemRow[];
  comments?: CommentRow[];
  userReaction?: string | null;
  userMarkedHelped?: boolean;
  userConfirmedValidToday?: boolean;
  isBookmarked?: boolean;
}) {
  const {
    post,
    priceHistory = [],
    receipt = null,
    receiptItems = [],
    comments = [],
    userReaction = null,
    userMarkedHelped = false,
    userConfirmedValidToday = false,
    isBookmarked = false,
  } = params;

  return {
    id: post.id,
    code: post.public_code,
    // Откъде идва цената: потребител, кошче на касата, брошура, сигнал от TikTok.
    source: post.source ?? 'user',
    sourceNote: post.source_note ?? null,
    // Линк към продукта (само при оферти от онлайн магазин).
    sourceUrl: post.source_url ?? null,
    polarity: post.polarity,
    category: post.category,
    customCategoryLabel: post.custom_category_label ?? undefined,
    platformTag: post.platform_tag,
    customPlatformLabel: post.custom_platform_label ?? undefined,
    title: post.title,
    description: post.description,
    placeName: post.place_name,
    city: post.city,
    address: post.address ?? undefined,
    latitude: post.latitude ?? undefined,
    longitude: post.longitude ?? undefined,
    googleMapsUrl: post.google_maps_url ?? undefined,
    locationAutoDetected: post.location_auto_detected,
    pricePaid: post.price_paid,
    referencePrice: post.reference_price ?? undefined,
    currency: currencyLabel(post.currency),
    unitQuantity: post.unit_quantity ?? undefined,
    unitType: (post.unit_type as 'g' | 'kg' | 'ml' | 'l' | 'pcs' | null) ?? undefined,
    pricePerKgOrLiter: post.price_per_unit ?? undefined,
    isShrinkflation: post.is_shrinkflation,
    isFakePromo: post.is_fake_promo,
    verifiedValidTodayCount: post.verified_valid_today_count,
    userConfirmedValidToday,
    lastVerifiedAt: post.last_verified_at ? iso(post.last_verified_at) : undefined,
    priceHistory: priceHistory.map((h) => ({
      id: h.id,
      price: h.price,
      recordedAt: iso(h.created_at),
      reportedBy: h.reporter_name ?? 'SmartPrice',
      status: h.status,
    })),
    imageUri: post.image_url,
    comparisonImageUri: post.comparison_image_url ?? undefined,
    comparisonLabel: post.comparison_label ?? undefined,
    // Частни продавачи: тип, коментар „къде и кога да го намериш“ и контакт
    sellerType: post.seller_type ?? 'business',
    sellerNote: post.seller_note ?? undefined,
    sellerContact: post.seller_contact ?? undefined,
    receipt: mapReceipt(receipt, receiptItems),
    author: {
      id: post.author.id,
      name: post.author.name,
      handle: post.author.handle,
      avatar: post.author.avatar ?? '',
      isSupporter: post.author.isSupporter,
      badgeTitle: post.author.badgeTitle,
    },
    createdAt: iso(post.created_at),
    reactions: {
      topDeal: post.reactions.topDeal ?? 0,
      worthIt: post.reactions.worthIt ?? 0,
      doubt: post.reactions.doubt ?? 0,
      pureRobbery: post.reactions.pureRobbery ?? 0,
      avoid: post.reactions.avoid ?? 0,
      exaggerated: post.reactions.exaggerated ?? 0,
    },
    userReaction: userReaction ?? undefined,
    helpedCount: post.helped_count,
    signalCount: post.signal_count ?? 1,
    communitySavedBgn: post.community_saved_bgn,
    userMarkedHelped,
    isBookmarked,
    comments: comments.map(mapComment),
    tags: post.tags,
  };
}

export function mapComment(c: CommentRow) {
  return {
    id: c.id,
    postId: c.post_id,
    authorId: c.author_id,
    authorName: c.author_name,
    authorHandle: c.author_handle,
    authorAvatar: c.author_avatar ?? '',
    authorIsSupporter: c.author_is_supporter,
    text: c.body,
    imageUri: c.image_url ?? undefined,
    reportedPrice: c.reported_price ?? undefined,
    createdAt: iso(c.created_at),
    likes: c.likes_count,
  };
}

export function mapProfile(p: {
  id: string;
  email: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  bio: string;
  city: string;
  role?: string | null;
  is_supporter: boolean;
  supporter_since: Date | string | null;
  supporter_tier: string | null;
  total_donated_bgn: number;
  personal_saved_bgn: number;
  reputation_points: number;
  last_donation_prompt_at: Date | string | null;
  interactions_since_prompt: number;
  nudge_snoozed_until: Date | string | null;
  posts_count?: number;
  verified_receipts_count?: number;
  community_saved_bgn?: number;
  referral_code?: string | null;
  referral_points?: number;
  referrals_invited?: number;
  referrals_rewarded?: number;
  referrals_pending?: number;
  created_at?: Date | string | null;
  source?: string | null;
  source_note?: string | null;
}, extras: {
  badges: Array<{
    id: string;
    title: string;
    icon: string;
    description: string;
    color: string;
    unlocked: boolean;
    metric?: string | null;
    threshold?: number;
    progress?: number;
  }>;
  donations: Array<{ id: string; amountBgn: number; tierName: string; isMonthly: boolean; createdAt: string; paymentIntentId: string }>;
}) {
  return {
    id: p.id,
    name: p.name,
    handle: p.handle,
    email: p.email,
    avatar: p.avatar_url ?? '',
    bio: p.bio,
    city: p.city,
    role: (p.role as 'user' | 'admin' | null) ?? 'user',
    isAdmin: p.role === 'admin',
    isSupporter: p.is_supporter,
    supporterSince: p.supporter_since ? iso(p.supporter_since) : undefined,
    supporterTier: (p.supporter_tier as 'coffee' | 'guardian' | 'legend' | null) ?? undefined,
    totalDonatedBgn: p.total_donated_bgn,
    totalSavedForCommunityBgn: p.community_saved_bgn ?? 0,
    personalSavedBgn: p.personal_saved_bgn,
    postsCount: p.posts_count ?? 0,
    verifiedReceiptsCount: p.verified_receipts_count ?? 0,
    reputationPoints: p.reputation_points,
    // --- Поканален цикъл ---------------------------------------------------
    referralCode: p.referral_code ?? '',
    referralPoints: p.referral_points ?? 0,
    referralsInvited: p.referrals_invited ?? 0,
    referralsRewarded: p.referrals_rewarded ?? 0,
    referralsPending: p.referrals_pending ?? 0,
    badges: extras.badges,
    donations: extras.donations,
    // Кога е създаден профилът — нужно на приложението, за да знае дали още
    // тече прозорецът на бонуса „Основател“.
    createdAt: p.created_at ? iso(p.created_at) : null,
    lastDonationPromptAt: p.last_donation_prompt_at ? new Date(iso(p.last_donation_prompt_at)).getTime() : null,
    interactionsSincePrompt: p.interactions_since_prompt,
    nudgeSnoozedUntil: p.nudge_snoozed_until ? new Date(iso(p.nudge_snoozed_until)).getTime() : null,
  };
}
