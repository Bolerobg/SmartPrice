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
import { useLocalSearchParams, useRouter } from 'expo-router';
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
          {amount ? `${amount} € — ще отвориш защитената страница за плащане` : 'Натисни сума'}
        </Text>
      </View>
    </View>
  );
};


/** 6. Жива цена — натисни „Бях на място“, за да видиш как се дописва историята */
const PriceHistoryDemo: React.FC = () => {
  const [step, setStep] = useState(0);
  // 0 = само първоначалната, 1 = поевтиня, 2 = потвърдена днес
  const entries = [
    { label: 'Първоначална цена', price: '6.20 €', color: COLORS.accentCyan, icon: 'pricetag-outline' },
    { label: 'Поевтиня с 1.19 €', price: '5.01 €', color: COLORS.greenBright, icon: 'trending-down' },
    { label: 'Потвърдена на място', price: '5.01 €', color: COLORS.greenBright, icon: 'checkmark-circle' },
  ].slice(0, step + 1);

  return (
    <View style={[demo.card, demo.cardGreen]}>
      <View style={demo.row}>
        <Text style={demo.emoji}>☕</Text>
        <View style={{ flex: 1 }}>
          <Text style={demo.title}>2 кафета + кроасан</Text>
          <Text style={demo.place}>Кафене „Тиха улица“ · София</Text>
        </View>
        <View style={demo.priceTag}>
          <Text style={[demo.price, { color: COLORS.greenBright }]}>5.01 €</Text>
        </View>
      </View>

      <View style={{ gap: 7, marginTop: 4 }}>
        {entries.map((e) => (
          <View key={e.label} style={demo.histRow}>
            <Ionicons name={e.icon as never} size={13} color={e.color} />
            <Text style={[demo.histLabel, { flex: 1 }]}>{e.label}</Text>
            <Text style={[demo.histPrice, { color: e.color }]}>{e.price}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={demo.actionBtn}
        onPress={() => setStep((s) => (s >= 2 ? 0 : s + 1))}
        activeOpacity={0.85}
      >
        <Ionicons
          name={step >= 2 ? 'refresh' : 'location'}
          size={14}
          color={COLORS.greenBright}
        />
        <Text style={[demo.hint, { color: COLORS.greenBright }]}>
          {step >= 2 ? 'Пак отначало' : step === 0 ? 'Бях на място — цената е същата' : 'Цената се промени!'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

/** 7. Значки — натисни заключената, за да я отключиш */
const BadgesDemo: React.FC = () => {
  const [unlocked, setUnlocked] = useState(1);
  const badges = [
    { title: 'Първи поглед', need: '1 проверка', color: '#06B6D4' },
    { title: 'Проверяващ', need: '5 проверки', color: '#22D3EE' },
    { title: 'Детектив на цени', need: '25 проверки', color: '#8B5CF6' },
  ];

  return (
    <View style={[demo.card, demo.cardGold]}>
      <View style={demo.badgeGrid}>
        {badges.map((b, i) => {
          const on = i < unlocked;
          return (
            <TouchableOpacity
              key={b.title}
              style={[demo.badgeBox, on && { borderColor: b.color, backgroundColor: `${b.color}1A` }]}
              onPress={() => setUnlocked((u) => (i + 1 === u ? Math.max(1, u - 1) : i + 1))}
              activeOpacity={0.85}
            >
              <Ionicons
                name={on ? 'ribbon' : 'lock-closed'}
                size={19}
                color={on ? b.color : COLORS.textMuted}
              />
              <Text style={[demo.badgeName, on && { color: COLORS.textPrimary }]} numberOfLines={1}>
                {b.title}
              </Text>
              <Text style={demo.badgeNeed}>{b.need}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={demo.hintRow}>
        <Ionicons name="trophy" size={14} color={COLORS.goldBright} />
        <Text style={[demo.hint, { color: COLORS.goldBright }]}>
          {unlocked >= 3
            ? 'Ти си „Проверяващ на седмицата“! 👑'
            : 'Натисни заключена значка, за да видиш как се отключва'}
        </Text>
      </View>
    </View>
  );
};

/** 8. Споделяне — натисни, за да „изпратиш“ офертата */
const ShareDemo: React.FC = () => {
  const [sent, setSent] = useState(false);
  return (
    <View style={[demo.card, demo.cardCyan]}>
      <View style={demo.row}>
        <Text style={demo.emoji}>🧀</Text>
        <View style={{ flex: 1 }}>
          <Text style={demo.title}>Овче сирене 1 кг</Text>
          <Text style={demo.place}>Фермерски щанд „Родопи“ · Пловдив</Text>
        </View>
        <Text style={[demo.price, { color: COLORS.greenBright }]}>8.13 €</Text>
      </View>

      {sent ? (
        <View style={demo.sharePreview}>
          <Ionicons name="logo-whatsapp" size={15} color={COLORS.greenBright} />
          <View style={{ flex: 1 }}>
            <Text style={demo.sharePreviewTitle}>🟢 ТОП НАХОДКА · Овче сирене 1 кг</Text>
            <Text style={demo.sharePreviewUrl}>smart.lookthis.online/post/…</Text>
          </View>
        </View>
      ) : (
        <View style={demo.hintRow}>
          <Ionicons name="finger-print" size={14} color={COLORS.accentCyan} />
          <Text style={[demo.hint, { color: COLORS.accentCyan }]}>
            Натисни, за да я изпратиш
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={demo.actionBtn}
        onPress={() => setSent((v) => !v)}
        activeOpacity={0.85}
      >
        <Ionicons
          name={sent ? 'refresh' : 'share-social'}
          size={14}
          color={COLORS.accentCyan}
        />
        <Text style={[demo.hint, { color: COLORS.accentCyan }]}>
          {sent ? 'Пак отначало' : 'Сподели с WhatsApp, Viber, Telegram…'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

/** 9. Инструменти — натисни, за да видиш за какво служи всяко */
const ToolsDemo: React.FC = () => {
  const [active, setActive] = useState<number | null>(null);
  const tools = [
    { icon: 'search', label: 'Търсене', hint: 'Пиши на кирилица — търси във всичко' },
    { icon: 'notifications', label: 'Радар', hint: 'Кажи до каква цена и ще те уведомим' },
    { icon: 'timer', label: 'Обратно броене', hint: 'Промоции, които изтичат' },
    { icon: 'navigate', label: 'Около мен', hint: 'Само оферти близо до теб' },
    { icon: 'bookmark', label: 'Запазени', hint: 'Намери после това, което ти хареса' },
  ];
  return (
    <View style={[demo.card, demo.cardIndigo]}>
      <View style={{ gap: 7 }}>
        {tools.map((t, i) => (
          <TouchableOpacity
            key={t.label}
            style={[demo.toolRow, active === i && demo.toolRowActive]}
            onPress={() => setActive((a) => (a === i ? null : i))}
            activeOpacity={0.85}
          >
            <Ionicons
              name={t.icon as never}
              size={15}
              color={active === i ? COLORS.accentCyan : COLORS.textSecondary}
            />
            <Text
              style={[
                demo.toolLabel,
                active === i && { color: COLORS.accentCyan },
              ]}
            >
              {t.label}
            </Text>
            {active === i && <Text style={demo.toolHint}>{t.hint}</Text>}
          </TouchableOpacity>
        ))}
      </View>
      <View style={demo.hintRow}>
        <Ionicons name="finger-print" size={14} color={COLORS.accentIndigo} />
        <Text style={[demo.hint, { color: COLORS.accentIndigo }]}>
          {active === null ? 'Натисни инструмент, за да видиш какво прави' : 'Натисни друг'}
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

  /**
   * Същият екран се ползва и като „преговор“ отвътре в приложението
   * (/tour?review=1) — тогава не пращаме никъде, а просто се връщаме назад.
   */
  const { review } = useLocalSearchParams<{ review?: string }>();
  const isReview = review === '1';
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
        key: 'history',
        emoji: '📊',
        gradient: ['#052E2B', '#0B0F1A'],
        eyebrow: 'ЖИВИ ЦЕНИ',
        title: 'Цената не е снимка',
        body:
          'Офертата се променя. Виждаш цялата ѝ история — кога е поскъпнала, кога е поевтиняла и кой я е проверявал.\n\nАко минеш оттам и цената не е вярна, поправяш я с две докосвания. Всеки след теб вижда вярното.',
        interactive: <PriceHistoryDemo />,
      },
      {
        key: 'badges',
        emoji: '🏅',
        gradient: ['#3B2A05', '#0B0F1A'],
        eyebrow: 'ЗНАЧКИ И КЛАСАЦИЯ',
        title: 'Помагаш и получаваш',
        body:
          'Всяка проверка носи точки доверие. Стигаш до нови значки — от „Първи поглед“ до „Пазител на цените“.\n\nВ Общност виждаш класацията: кой е спестил най-много, кой е проверил най-много и кой е Проверяващ на седмицата.',
        interactive: <BadgesDemo />,
      },
      {
        key: 'share',
        emoji: '📤',
        gradient: ['#1E1B4B', '#0B0F1A'],
        eyebrow: 'СПОДЕЛЯНЕ',
        title: 'Изпрати находката на приятел',
        body:
          'Всяка оферта има собствен линк. Изпращаш я в WhatsApp, Viber, Telegram, Facebook или по имейл — с едно натискане.\n\nПолучателят вижда снимката, цената и мястото, дори да няма профил. Така една находка стига до стотици хора.',
        interactive: <ShareDemo />,
      },
      {
        key: 'tools',
        emoji: '🧭',
        gradient: ['#1E1B4B', '#0B0F1A'],
        eyebrow: 'ИНСТРУМЕНТИ',
        title: 'Всичко останало',
        body:
          '🔎 Търсене на кирилица по всичко — „пиле“, „кафе“, „София“.\n🔔 Радар: кажи какво търсиш и до каква цена, ще те уведомим.\n⏳ Обратно броене за промоции, които изтичат.\n📍 „Около мен“ — само оферти близо до теб.\n🔖 Запазваш оферта, за да я намериш после.\n📱 Слагаш SmartPrice на началния екран и работи като приложение.',
        interactive: <ToolsDemo />,
      },
      {
        key: 'community',
        emoji: '🤝',
        gradient: ['#3B2A05', '#0B0F1A'],
        eyebrow: 'ОБЩНОСТ',
        title: 'Прозрачност, не реклами',
        body:
          'Виждаш колко оферти има, колко души участват и колко пари е спестила общността.\n\nНикой не може да си плати да скрием лошо ревю или да вдигнем цена. Затова тук има и какво да се провери.',
        interactive: <CommunityDemo />,
      },
      {
        key: 'support',
        emoji: '💛',
        gradient: ['#083344', '#0B0F1A'],
        eyebrow: 'НЕЗАВИСИМОСТ',
        title: 'Ти решаваш дали да подкрепиш',
        body:
          'Приложението е безплатно и без реклами. Ако ти е полезно, можеш да го подкрепиш с малка сума.\n\nНищо не е задължително — всички функции остават отворени.',
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
    if (isReview) {
      router.back();
      return;
    }
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    router.replace('/(auth)/register');
  }, [router, isReview]);

  const skip = useCallback(async () => {
    if (isReview) {
      router.back();
      return;
    }
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    router.replace('/(auth)/login');
  }, [router, isReview]);

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

      {/* Горна лента: пропусни (в режим „преглед“ има X, затова не се показва) */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => void skip()}
          hitSlop={12}
          style={[styles.skipBtn, isReview && { display: 'none' }]}
        >
          <Text style={styles.skipText}>Пропусни</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Долна лента: напредък + бутони */}
      {/* В режим „преговор“ има как да се излезе, без да се стига до края */}
      {isReview && (
        <TouchableOpacity
          style={[styles.reviewClose, { top: insets.top + 12 }]}
          onPress={() => router.back()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Затвори прегледа"
        >
          <Ionicons name="close" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
      )}

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
              <Text style={styles.primaryBtnText}>
                {isReview ? 'Готово' : 'Създай профил'}
              </Text>
            </TouchableOpacity>
            {!isReview && (
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => void skip()}
                activeOpacity={0.8}
              >
                <Text style={styles.ghostBtnText}>Вече имам профил</Text>
              </TouchableOpacity>
            )}
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

  /* Жива цена */
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  histLabel: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '700' },
  histPrice: { fontSize: 12, fontWeight: '900' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    borderRadius: 11,
    paddingVertical: 9,
    marginTop: 11,
  },

  /* Значки */
  badgeGrid: { flexDirection: 'row', gap: 7 },
  badgeBox: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(148,163,184,0.3)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  badgeName: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  badgeNeed: { color: COLORS.textMuted, fontSize: 9, textAlign: 'center' },

  /* Споделяне */
  sharePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    borderRadius: 11,
    padding: 10,
    marginTop: 11,
  },
  sharePreviewTitle: { color: COLORS.textPrimary, fontSize: 11.5, fontWeight: '800' },
  sharePreviewUrl: { color: COLORS.textMuted, fontSize: 10.5, marginTop: 2 },

  /* Инструменти */
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  toolRowActive: {
    borderColor: 'rgba(6,182,212,0.6)',
    backgroundColor: 'rgba(6,182,212,0.1)',
  },
  toolLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '800' },
  toolHint: { flex: 1, color: COLORS.textMuted, fontSize: 10.5, textAlign: 'right' },
});

const styles = StyleSheet.create({
  reviewClose: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
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
