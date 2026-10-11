import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants/theme';

export const ONBOARDING_SEEN_KEY = '@smartprice_onboarding_seen_v1';

interface Page {
  key: string;
  emoji: string;
  gradient: [string, string];
  eyebrow: string;
  title: string;
  body: string;
  /** Интерактивен елемент — потребителят натиска, за да види как работи */
  interactive: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Интерактивни демонстрации за всяка страница                        */
/* ------------------------------------------------------------------ */

/** 1. Топ находка — натисни, за да видиш колко е спестено */
const GreenFindDemo: React.FC = () => {
  const [revealed, setRevealed] = useState(false);
  return (
    <TouchableOpacity
      style={[demo.card, demo.cardGreen]}
      onPress={() => setRevealed((v) => !v)}
      activeOpacity={0.85}
    >
      <View style={demo.row}>
        <Text style={demo.emoji}>🧀</Text>
        <View style={{ flex: 1 }}>
          <Text style={demo.title}>Овче сирене 1 кг</Text>
          <Text style={demo.place}>Фермерски щанд „Родопи“ · Пловдив</Text>
        </View>
        <View style={demo.priceTag}>
          <Text style={demo.price}>8.13 €</Text>
          {revealed && <Text style={demo.wasPrice}>15.90 €</Text>}
        </View>
      </View>
      <View style={demo.hintRow}>
        <Ionicons
          name={revealed ? 'checkmark-circle' : 'finger-print'}
          size={14}
          color={COLORS.greenBright}
        />
        <Text style={[demo.hint, { color: COLORS.greenBright }]}>
          {revealed ? 'Спестяваш 7.77 € (−49%)' : 'Натисни, за да видиш спестеното'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

/** 2. Червен флаг — натисни, за да видиш проблема */
const RedFlagDemo: React.FC = () => {
  const [revealed, setRevealed] = useState(false);
  return (
    <TouchableOpacity
      style={[demo.card, demo.cardRed]}
      onPress={() => setRevealed((v) => !v)}
      activeOpacity={0.85}
    >
      <View style={demo.row}>
        <Text style={demo.emoji}>🚩</Text>
        <View style={{ flex: 1 }}>
          <Text style={demo.title}>Минерална вода 330 мл</Text>
          <Text style={demo.place}>Заведение „Крайбрежен Бриз“ · Созопол</Text>
        </View>
        <View style={demo.priceTag}>
          <Text style={[demo.price, { color: COLORS.redBright }]}>3.53 €</Text>
        </View>
      </View>
      <View style={demo.hintRow}>
        <Ionicons
          name={revealed ? 'alert-circle' : 'finger-print'}
          size={14}
          color={COLORS.redBright}
        />
        <Text style={[demo.hint, { color: COLORS.redBright }]}>
          {revealed
            ? 'Скрита „такса куверт“ — не е обявена в менюто'
            : 'Натисни, за да видиш какъв е проблемът'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

/** 3. Скенер на бележки — натисни, за да „сканираш“ */
const OcrDemo: React.FC = () => {
  const [state, setState] = useState<'idle' | 'scanning' | 'done'>('idle');
  const run = () => {
    if (state !== 'idle') {
      setState('idle');
      return;
    }
    setState('scanning');
    setTimeout(() => setState('done'), 1200);
  };
  return (
    <TouchableOpacity
      style={[demo.card, demo.cardIndigo]}
      onPress={run}
      activeOpacity={0.85}
    >
      <View style={demo.row}>
        <Text style={demo.emoji}>🧾</Text>
        <View style={{ flex: 1 }}>
          <Text style={demo.title}>
            {state === 'idle' ? 'Снимка на касова бележка' : state === 'scanning' ? 'Разчитам…' : 'Готово!'}
          </Text>
          <Text style={demo.place}>
            {state === 'done'
              ? 'СУПЕРМАРКЕТ ДЕМО ЕООД · 4 артикула'
              : 'Пусни снимката — AI чете вместо теб'}
          </Text>
        </View>
      </View>
      {state === 'done' ? (
        <View style={{ marginTop: 10, gap: 5 }}>
          {[
            ['Краве масло 82%', '2 × 4.49 = 8.98'],
            ['Прясно мляко 3.6%', '1 × 2.39 = 2.39'],
            ['Кашкавал краве', '1 × 8.29 = 8.29'],
          ].map(([n, p]) => (
            <View key={n} style={demo.itemRow}>
              <Text style={demo.itemName}>{n}</Text>
              <Text style={demo.itemPrice}>{p}</Text>
            </View>
          ))}
          <View style={[demo.itemRow, { marginTop: 4 }]}>
            <Text style={[demo.itemName, { fontWeight: '900' }]}>ОБЩО</Text>
            <Text style={[demo.itemPrice, { color: COLORS.accentCyan, fontWeight: '900' }]}>
              19.96 €
            </Text>
          </View>
        </View>
      ) : (
        <View style={demo.hintRow}>
          <Ionicons
            name={state === 'scanning' ? 'hourglass-outline' : 'finger-print'}
            size={14}
            color={COLORS.accentIndigo}
          />
          <Text style={[demo.hint, { color: COLORS.accentIndigo }]}>
            {state === 'scanning' ? 'Изкуствен интелект чете бележката…' : 'Натисни за демонстрация'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

/** 4. Общност — натисни, за да „дадеш“ сигнал */
const CommunityDemo: React.FC = () => {
  const [helped, setHelped] = useState(false);
  return (
    <TouchableOpacity
      style={[demo.card, demo.cardGold]}
      onPress={() => setHelped((v) => !v)}
      activeOpacity={0.85}
    >
      <View style={demo.row}>
        <Text style={demo.emoji}>{helped ? '🏅' : '👥'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={demo.title}>
            {helped ? 'Благодарим! Значка отключена' : 'Класация на защитниците'}
          </Text>
          <Text style={demo.place}>
            {helped ? 'Вече си Пазител на Общността' : 'Помагаш на другите да не се минават'}
          </Text>
        </View>
      </View>
      <View style={{ marginTop: 10, gap: 7 }}>
        {[
          ['🥇', 'Вики', '312 €'],
          ['🥈', 'Мартин', '198 €'],
          ['🥉', helped ? 'Ти' : '…', helped ? '7.77 €' : '—'],
        ].map(([medal, name, saved]) => (
          <View key={name} style={demo.leaderRow}>
            <Text style={demo.leaderMedal}>{medal}</Text>
            <Text style={[demo.leaderName, name === 'Ти' && { color: COLORS.goldBright }]}>
              {name}
            </Text>
            <Text style={[demo.leaderSaved, name === 'Ти' && { color: COLORS.goldBright }]}>
              {saved}
            </Text>
          </View>
        ))}
      </View>
      <View style={demo.hintRow}>
        <Ionicons name="finger-print" size={14} color={COLORS.goldBright} />
        <Text style={[demo.hint, { color: COLORS.goldBright }]}>
          {helped ? 'Натисни пак, за да върнеш' : 'Натисни, за да помогнеш и ти'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

/** 5. Подкрепа — натисни, за да „дариш“ */
const DonateDemo: React.FC = () => {
  const [amount, setAmount] = useState<number | null>(null);
  return (
    <View style={[demo.card, demo.cardCyan]}>
      <View style={demo.row}>
        <Text style={demo.emoji}>💛</Text>
        <View style={{ flex: 1 }}>
          <Text style={demo.title}>Без реклами. Без платени ревюта.</Text>
          <Text style={demo.place}>Приложението живее от хората, които го ползват</Text>
        </View>
      </View>
      <View style={demo.tierRow}>
        {[2, 5, 10].map((v) => (
          <TouchableOpacity
            key={v}
            style={[demo.tier, amount === v && demo.tierActive]}
            onPress={() => setAmount(amount === v ? null : v)}
            activeOpacity={0.85}
          >
            <Text style={[demo.tierAmount, amount === v && { color: COLORS.black }]}>
              {v} €
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={demo.hintRow}>
        <Ionicons name="finger-print" size={14} color={COLORS.accentCyan} />
        <Text style={[demo.hint, { color: COLORS.accentCyan }]}>
          {amount ? `${amount} € — ще отвориш защитената страница на Stripe` : 'Натисни сума'}
        </Text>
      </View>
    </View>
  );
};

/* ------------------------------------------------------------------ */
/*  Самият onboarding                                                  */
/* ------------------------------------------------------------------ */

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Ширината се взема динамично — така работи и при завъртане/преоразмеряване
  // в браузър, а не само при първоначално зареждане.
  const { width: pageWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  const pages: Page[] = useMemo(
    () => [
      {
        key: 'welcome',
        emoji: '🛒',
        gradient: ['#1E1B4B', '#0B0F1A'],
        eyebrow: 'ДОБРЕ ДОШЪЛ',
        title: 'SmartPrice',
        body:
          'Място, където хората споделят реалните цени, които са платили — без реклами и без платени ревюта.\n\nОткриваш къде е изгодно и къде те минават.',
        interactive: <GreenFindDemo />,
      },
      {
        key: 'finds',
        emoji: '✅',
        gradient: ['#052E2B', '#0B0F1A'],
        eyebrow: 'ТОП НАХОДКИ',
        title: 'Къде си струва',
        body:
          'Зелените публикации са реални оферти — с цена, място и доказателство.\n\nВиждаш колко си спестил спрямо обичайното.',
        interactive: <GreenFindDemo />,
      },
      {
        key: 'flags',
        emoji: '🚩',
        gradient: ['#3B0A16', '#0B0F1A'],
        eyebrow: 'ЧЕРВЕНИ ФЛАГОВЕ',
        title: 'Къде те минават',
        body:
          'Шринкфлация (по-малко грамаж, същата цена), скрити такси „куверт“, фалшиви промоции.\n\nОбщността ги хваща и показва.',
        interactive: <RedFlagDemo />,
      },
      {
        key: 'ocr',
        emoji: '🧾',
        gradient: ['#1E1B4B', '#0B0F1A'],
        eyebrow: 'AI СКЕНЕР',
        title: 'Снимай бележката',
        body:
          'Направи снимка на касовата бележка и AI ще прочете търговеца, ЕИК-а и всички артикули с цените.\n\nНе е нужно да въвеждаш нищо на ръка.',
        interactive: <OcrDemo />,
      },
      {
        key: 'community',
        emoji: '🏅',
        gradient: ['#3B2A05', '#0B0F1A'],
        eyebrow: 'ОБЩНОСТ',
        title: 'Помагаш и получаваш',
        body:
          'Всеки сигнал помага на другите да не се минават. Събираш точки доверие и значки.\n\nНай-активните стават Пазители на Общността.',
        interactive: <CommunityDemo />,
      },
      {
        key: 'support',
        emoji: '💛',
        gradient: ['#083344', '#0B0F1A'],
        eyebrow: 'НЕЗАВИСИМОСТ',
        title: 'Ти решаваш дали да подкрепиш',
        body:
          'Приложението е безплатно и без реклами. Ако ти е полезно, можеш да го подкрепиш с малка сума през Stripe.\n\nНищо не е задължително — всички функции остават отворени.',
        interactive: <DonateDemo />,
      },
    ],
    []
  );

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, next));
      scrollRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
      setIndex(clamped);
    },
    [pageWidth, pages.length]
  );

  const finish = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    router.replace('/(auth)/register');
  }, [router]);

  const skip = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    router.replace('/(auth)/login');
  }, [router]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / pageWidth);
    if (i !== index) setIndex(i);
    progress.setValue(pages.length > 1 ? i / (pages.length - 1) : 1);
  };

  const isLast = index === pages.length - 1;

  return (
    <View style={styles.flex}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.flex}
      >
        {pages.map((page) => (
          <View key={page.key} style={{ width: pageWidth }}>
            <LinearGradient colors={page.gradient} style={styles.page}>
              {/* Вертикален скрол: на по-нисък екран съдържанието се събира
                  без да се реже. Преди тук нямаше вертикален скрол и текстът
                  се отрязваше на малки телефони. */}
              <ScrollView
                contentContainerStyle={[
                  styles.pageInner,
                  {
                    paddingTop: insets.top + 62,
                    paddingBottom: 24,
                  },
                ]}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.emojiCircle}>
                  <Text style={styles.emojiBig}>{page.emoji}</Text>
                </View>

                <Text style={styles.eyebrow}>{page.eyebrow}</Text>
                <Text style={styles.pageTitle}>{page.title}</Text>
                <Text style={styles.pageBody}>{page.body}</Text>

                <View style={styles.demoWrap}>{page.interactive}</View>
              </ScrollView>
            </LinearGradient>
          </View>
        ))}
      </ScrollView>

      {/* Горна лента: пропусни */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => void skip()} hitSlop={12} style={styles.skipBtn}>
          <Text style={styles.skipText}>Пропусни</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Долна лента: напредък + бутони */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) + 10 }]}>
        <View style={styles.dotsRow}>
          {pages.map((p, i) => (
            <TouchableOpacity key={p.key} onPress={() => goTo(i)} hitSlop={8}>
              <View
                style={[
                  styles.dot,
                  i === index && styles.dotActive,
                  i < index && styles.dotDone,
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        {isLast ? (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => void finish()}
              activeOpacity={0.9}
            >
              <Text style={styles.primaryBtnText}>Създай профил</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ghostBtn}
              onPress={() => void skip()}
              activeOpacity={0.8}
            >
              <Text style={styles.ghostBtnText}>Вече имам профил</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => goTo(index + 1)}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>Напред</Text>
            <Ionicons name="arrow-forward" size={17} color={COLORS.black} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const demo = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 15,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  cardGreen: { borderColor: 'rgba(34,197,94,0.45)' },
  cardRed: { borderColor: 'rgba(239,68,68,0.45)' },
  cardIndigo: { borderColor: 'rgba(99,102,241,0.5)' },
  cardGold: { borderColor: 'rgba(251,191,36,0.45)' },
  cardCyan: { borderColor: 'rgba(6,182,212,0.5)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  emoji: { fontSize: 26 },
  title: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '800' },
  place: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 2 },
  priceTag: { alignItems: 'flex-end' },
  price: { color: COLORS.greenBright, fontSize: 16, fontWeight: '900' },
  wasPrice: {
    color: COLORS.textMuted,
    fontSize: 11.5,
    textDecorationLine: 'line-through',
    marginTop: 1,
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11 },
  hint: { fontSize: 11.5, fontWeight: '800' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between' },
  itemName: { color: COLORS.textSecondary, fontSize: 11.5 },
  itemPrice: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '700' },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  leaderMedal: { fontSize: 14 },
  leaderName: { flex: 1, color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700' },
  leaderSaved: { color: COLORS.greenBright, fontSize: 12.5, fontWeight: '800' },
  tierRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  tier: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(6,182,212,0.5)',
    paddingVertical: 11,
    alignItems: 'center',
  },
  tierActive: { backgroundColor: COLORS.accentCyan, borderColor: COLORS.accentCyan },
  tierAmount: { color: COLORS.accentCyan, fontSize: 15, fontWeight: '900' },
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bgPrimary },
  page: { flex: 1 },
  pageInner: {
    flexGrow: 1,
    paddingHorizontal: 26,
    justifyContent: 'center',
  },
  emojiCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emojiBig: { fontSize: 34 },
  eyebrow: {
    color: COLORS.accentCyan,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 8,
  },
  pageTitle: {
    color: COLORS.textPrimary,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 35,
  },
  pageBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 12,
  },
  demoWrap: { marginTop: 22 },
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 38,
    right: 18,
    left: 18,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  skipBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 6 },
  skipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  bottomBar: {
    paddingHorizontal: 26,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
    paddingTop: 14,
    backgroundColor: COLORS.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    gap: 10,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.borderSubtle,
  },
  dotDone: { backgroundColor: COLORS.accentCyan, opacity: 0.55 },
  dotActive: { width: 22, backgroundColor: COLORS.accentCyan },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.accentCyan,
    borderRadius: 15,
    paddingVertical: 16,
    minHeight: 54,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 16, fontWeight: '900' },
  ghostBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  ghostBtnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '800' },
});
