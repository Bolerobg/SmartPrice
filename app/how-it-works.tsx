import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { api } from '@/src/api/client';
import { formatNumber } from '@/src/lib/format';

/**
 * ℹ️ „Как работи“ — простичко обяснение какво прави приложението и защо числата му
 * са честни. Без вътрешни подробности за това откъде идват цените: казваме, че
 * „сверяваме каталозите на веригите“ и че го правим наново всяка седмица.
 */
export default function HowItWorksScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<{ offers: number; products: number; chains: number; cities: number } | null>(
    null
  );

  useEffect(() => {
    let alive = true;
    api
      .chains()
      .then((res) => {
        if (alive && res.stats) setStats(res.stats);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const rows: Array<{ icon: string; title: string; body: string; to?: string }> = [
    {
      icon: 'people',
      title: '1. Оферти от хора',
      body:
        'Всеки може да качи цена с бележка или снимка. Другите гласуват, потвърждават цената днес или я отбелязват като „Не ходи“. Затова при находките виждаш колко души са сигнализирали и колко пъти е помогнало.',
    },
    {
      icon: 'cart',
      title: '2. Сверени цени от веригите',
      body:
        stats
          ? `Сверяваме каталозите на ${stats.chains} вериги (Кауфланд, Метро, Билла, Фантастико, СБА…) в ${stats.cities} града — ${formatNumber(stats.offers)} цени за ${formatNumber(stats.products)} продукта. Правят се наново всяка седмица, затова виждаш и кога е последната сверка.`
          : 'Сверяваме каталозите на веригите (Кауфланд, Метро, Билла…) и ги обновяваме всяка седмица.',
      to: '/chains-compare',
    },
    {
      icon: 'swap-horizontal',
      title: '3. Ценови дуел',
      body:
        'Намираме същия продукт и в други вериги и показваме разликата: „тук е с 22% по-скъпо, отколкото в…“. Сравняваме само еднакви неща — еднакъв грамаж и вид, не „сирене 200 г“ с „сирене 400 г“.',
    },
    {
      icon: 'basket',
      title: '4. Кошница: целият списък по вериги',
      body:
        'Въвеждаш какво пазаруваш (мляко, сирене, яйца…) и виждаш колко би струвал във всяка верига, коя е най-евтина и коя двойка вериги излиза най-изгодно. Казваме и колко продукта от списъка ги има в дадена верига — не скриваме липсващото.',
    },
    {
      icon: 'pricetags',
      title: '5. Разлики между веригите',
      body:
        'По категории: къде е най-евтино и колко по-скъпо е другаде. Сравняваме ТИПИЧНАТА цена (медианата), не най-евтината оферта — иначе една промоция щеше да направи цялата верига „най-евтина“.',
      to: '/chains-compare',
    },
    {
      icon: 'help-buoy',
      title: '6. Как да помогнеш (най-полезното)',
      body:
        'Качи оферта, която виждаш. Потвърди „валидна днес“ за цените, които и ти виждаш същите. Гласувай и коментирай — така една цена, проверена от човек днес, тежи повече от сто непроверени.',
    },
    {
      icon: 'alert-circle',
      title: '7. Защо понякога няма „средна цена“',
      body:
        'В един онлайн магазин или верига има крушка за 0.35 € и машина за 1240 €. Средна цена на такова място не значи нищо и плаши, затова там показваме цени ПО КАТЕГОРИИ.',
    },
    {
      icon: 'trophy',
      title: '8. Значката 🥇 „най-изгодни цени“',
      body:
        'Дава се само при честни условия: типичната цена на веригата в категорията е поне 5% под следващата, при поне 5 оферти на победителя и поне 3 вериги за сравнение. Пишем с колко вериги е сравнено — за да можеш сам да прецениш.',
    },
  ];

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Как работи</Text>
          <View style={{ width: 22 }} />
        </View>

        <Text style={styles.lead}>
          SmartPrice сравнява цени, за да не се въртиш по магазините за 20 стотинки. Ето какво
          прави и защо можеш да вярваш на числата.
        </Text>

        {rows.map((r) => (
          <View key={r.title} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.iconWrap}>
                <Ionicons name={r.icon as never} size={17} color={COLORS.accentCyan} />
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {r.title}
              </Text>
            </View>
            <Text style={styles.body}>{r.body}</Text>
            {r.to ? (
              <TouchableOpacity
                style={styles.linkBtn}
                activeOpacity={0.85}
                onPress={() => router.push(r.to as never)}
              >
                <Text style={styles.linkText}>Виж го в приложението</Text>
                <Ionicons name="chevron-forward" size={15} color={COLORS.accentCyan} />
              </TouchableOpacity>
            ) : null}
          </View>
        ))}

        <View style={styles.footer}>
          <Ionicons name="checkmark-circle" size={15} color={COLORS.greenBright} />
          <Text style={styles.footerText}>
            Не показваме чужди сайтове и не те пращаме другаде: цените са тук, за да се сравняват
            тук. Когато не сме сигурни в нещо, по-добре да не го покажем, отколкото да те подведем.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 16, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitle: { color: COLORS.textPrimary, fontSize: 19, fontWeight: '900' },
  lead: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.30)',
  },
  title: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900', flex: 1 },
  body: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  linkText: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '800' },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    backgroundColor: COLORS.greenSoftBg,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
  },
  footerText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 },
});
