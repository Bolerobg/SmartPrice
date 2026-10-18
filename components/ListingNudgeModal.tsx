import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { api } from '@/src/api/client';

/**
 * 🎁 Моделът за КУПУВАЧА: „и ти можеш да продаваш“.
 *
 * Правилата, които спазваме (искане на собственика: да не досажда):
 *   • показва се най-много веднъж на 14 дни (сървърът решава — виж /api/listings/nudge);
 *   • не се показва на някого, който вече има обяви;
 *   • има „По-късно“ (скрива се за 14 дни) и „Не ми показвай повече“ (завинаги);
 *   • обяснява за 3 стъпки как става и води директно към пускането на обява.
 */
interface Props {
  visible: boolean;
  priceEur: number;
  days: number;
  /** Отворен ръчно от „Как работи?“ — тогава „По-късно“ само затваря,
   *  без да отбелязва подканата като видяна (иначе човекът губи поканата). */
  manual?: boolean;
  onClose: () => void;
  onGoToNew: () => void;
}

export const ListingNudgeModal: React.FC<Props> = ({
  visible,
  priceEur,
  days,
  manual = false,
  onClose,
  onGoToNew,
}) => {
  const [busy, setBusy] = useState('');
  const [step, setStep] = useState(0);

  const later = async () => {
    if (manual) {
      onClose();
      return;
    }
    setBusy('later');
    await api.listingNudgeSeen().catch(() => undefined);
    setBusy('');
    onClose();
  };

  const never = async () => {
    setBusy('never');
    await api.listingNudgeOff(true).catch(() => undefined);
    setBusy('');
    onClose();
  };

  const steps = [
    {
      icon: 'camera-outline' as const,
      title: 'Снимаш го',
      text: 'До 5 снимки. Първата е корицата — направи я на светло, за да се вижда добре.',
    },
    {
      icon: 'pricetag-outline' as const,
      title: 'Пишеш цена',
      text: 'Ако не знаеш колко да искаш — погледни какви цени са сложили другите в същата категория.',
    },
    {
      icon: 'card-outline' as const,
      title: `Плащаш ${priceEur.toFixed(2)} €`,
      text: `Обявата стои ${days} дни. Като я продадеш — натискаш „Продадено“ и тя изчезва.`,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void later()}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={{ paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Ionicons name="pricetags" size={26} color={COLORS.black} />
              </View>
              <Text style={styles.heroTitle}>Имаш нещо втора ръка?</Text>
              <Text style={styles.heroText}>
                Хиляди хора тук търсят точно това, което ти стои в шкафа. Пусни го за 2 минути — ще го видят
                всички в приложението.
              </Text>
            </View>

            <View style={styles.proof}>
              <Ionicons name="trending-up" size={15} color={COLORS.greenBright} />
              <Text style={styles.proofText}>
                Обявите в категория „Деца“ се отварят средно {''} <Text style={{ fontWeight: '900' }}>над 40 пъти</Text> в
                първите 3 дни.
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Как става — 3 стъпки</Text>
            {steps.map((s, i) => (
              <TouchableOpacity
                key={s.title}
                style={[styles.step, step === i && styles.stepActive]}
                onPress={() => setStep(step === i ? -1 : i)}
                activeOpacity={0.85}
              >
                <View style={styles.stepIcon}>
                  <Ionicons name={s.icon} size={17} color={COLORS.accentCyan} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>
                    {i + 1}. {s.title}
                  </Text>
                  {step === i ? <Text style={styles.stepText}>{s.text}</Text> : null}
                </View>
                <Ionicons name={step === i ? 'chevron-up' : 'chevron-down'} size={15} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}

            <View style={styles.priceBox}>
              <Text style={styles.priceValue}>{priceEur.toFixed(2)} €</Text>
              <Text style={styles.priceNote}>
                за {days} дни · до 5 снимки · спираш я, когато поискаш
              </Text>
            </View>

            <TouchableOpacity style={styles.cta} onPress={onGoToNew} activeOpacity={0.9}>
              <Ionicons name="add-circle" size={19} color={COLORS.black} />
              <Text style={styles.ctaText}>Пусни обява сега</Text>
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <TouchableOpacity onPress={() => void later()} disabled={busy !== ''}>
                <Text style={styles.footerLink}>По-късно</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void never()} disabled={busy !== ''}>
                <Text style={[styles.footerLink, { color: COLORS.textMuted }]}>Не ми показвай повече</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(4,8,16,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.bgCard,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 18,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  hero: { alignItems: 'center', gap: 6, marginBottom: 12 },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.greenPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  heroText: { color: COLORS.textSecondary, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  proof: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 14,
    padding: 11,
  },
  proofText: { color: COLORS.textPrimary, fontSize: 12.5, flex: 1 },
  sectionTitle: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, marginTop: 16, marginBottom: 8 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    backgroundColor: COLORS.bgCardElevated,
    marginBottom: 8,
  },
  stepActive: { borderColor: 'rgba(34,211,238,0.4)', backgroundColor: 'rgba(34,211,238,0.08)' },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.12)',
  },
  stepTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '800' },
  stepText: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  priceBox: { alignItems: 'center', marginTop: 14, marginBottom: 6 },
  priceValue: { color: COLORS.greenBright, fontSize: 26, fontWeight: '900' },
  priceNote: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 2 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: COLORS.greenPrimary,
    marginTop: 10,
  },
  ctaText: { color: COLORS.black, fontSize: 15, fontWeight: '900' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  footerLink: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700' },
});
