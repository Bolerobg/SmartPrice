import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { api, type ShopPriceCheck } from '@/src/api/client';

/**
 * Сверка с магазина: „нашата цена ↔ цената в сайта сега“.
 *
 * Защо е отделен компонент: същият блок трябва да го има и на екрана на
 * офертата (влезли потребители), и в публичния преглед (гост по споделен линк).
 * Един код = едни думи, без да се разминават.
 *
 * Правило за честност: ако магазинът не отговори или няма цена, казваме защо —
 * не показваме измислено число.
 */
interface Props {
  postId: string;
  /** Нашата записана цена (евро). */
  ourPriceEur: number;
  /** Начало на проверките — за да не питаме празно, ако родителят иска друго. */
  compact?: boolean;
  /** Гост (без профил): сверката се вижда, но магазинът иска регистрация. */
  guest?: boolean;
  /** Какво да направим, когато гост натисне „Регистрирай се“. */
  onRequireAuth?: () => void;
}

/** Какво да кажем под двете числа. */
function verdict(c: ShopPriceCheck | null): string {
  if (!c) return 'Провери с едно натискане — четем цената от сайта на магазина в момента.';
  if (!c.ok || c.diffEur === null) return c.reason ?? 'Не успях да проверя цената в магазина.';
  const d = c.diffEur;
  if (Math.abs(d) < 0.01) return 'Същата цена — офертата е валидна ✓';

  // Промоцията в магазина е приключила: сега там е редовната цена, а ние сме
  // записали промоционалната. Казваме го с думи, за да не изглежда като наша грешка.
  const list = c.listPriceEur;
  if (d > 0 && list !== undefined && Math.abs(list - (c.priceEur ?? 0)) < 0.01 && c.ourPriceEur < list) {
    return `Промоцията в магазина е приключила — сега е редовната цена ${list.toFixed(2)} €. Ние сме я видели за ${c.ourPriceEur.toFixed(2)} € (промо).`;
  }
  return d > 0
    ? // Без обявена редовна цена не твърдим нищо — само подсказваме честно.
      d >= 3
      ? `В магазина е с ${d.toFixed(2)} € по-скъпо — възможно е нашата цена да е била от промоция. Провери в сайта.`
      : `В магазина е с ${d.toFixed(2)} € по-скъпо — още си на далавера ✓`
    : `В магазина е с ${Math.abs(d).toFixed(2)} € по-евтино — провери пак`;
}

/** Цвят: по-скъпо в магазина = добре за нас; по-евтино = лошо. */
function verdictColor(c: ShopPriceCheck | null): string {
  if (!c || !c.ok || c.diffEur === null) return COLORS.textSecondary;
  if (Math.abs(c.diffEur) < 0.01) return COLORS.greenBright;
  return c.diffEur > 0 ? COLORS.greenBright : COLORS.redBright;
}

export const ShopPriceCompare: React.FC<Props> = ({
  postId,
  ourPriceEur,
  compact,
  guest,
  onRequireAuth,
}) => {
  const [check, setCheck] = useState<ShopPriceCheck | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setCheck(await api.shopPrice(postId, Boolean(check)));
    } catch (err) {
      setCheck({
        ok: false,
        checkedAt: new Date().toISOString(),
        reason: err instanceof Error ? err.message : 'Не успях да проверя цената в магазина.',
        ourPriceEur,
        shopName: '',
        postTitle: '',
        diffEur: null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={{
        marginTop: 10,
        padding: 10,
        borderRadius: 12,
        backgroundColor: 'rgba(96, 165, 250, 0.08)',
        borderWidth: 1,
        borderColor: 'rgba(96, 165, 250, 0.25)',
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}
          >
            НАШАТА ЦЕНА
          </Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '900' }}>
            {ourPriceEur.toFixed(2)} €
          </Text>
        </View>
        <Ionicons name="swap-horizontal" size={18} color={COLORS.textMuted} />
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}
          >
            В МАГАЗИНА СЕГА
          </Text>
          {check?.ok && check.priceEur !== undefined ? (
            <Text style={{ color: verdictColor(check), fontSize: 18, fontWeight: '900' }}>
              {check.priceEur.toFixed(2)} €
            </Text>
          ) : (
            <Text style={{ color: COLORS.textSecondary, fontSize: 15, fontWeight: '800' }}>
              {busy ? '…' : '— €'}
            </Text>
          )}
          {check?.ok && check.listPriceEur !== undefined ? (
            <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>
              редовна {check.listPriceEur.toFixed(2)} €
            </Text>
          ) : null}
        </View>
      </View>

      <Text style={{ color: verdictColor(check), fontSize: 11.5, fontWeight: '700' }}>
        {busy ? 'Проверявам сайта на магазина…' : verdict(check)}
      </Text>

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={busy}
        onPress={() => void run()}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 9,
          borderRadius: 10,
          backgroundColor: 'rgba(96, 165, 250, 0.18)',
          borderWidth: 1,
          borderColor: 'rgba(96, 165, 250, 0.4)',
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#60A5FA" />
        ) : (
          <Ionicons name="refresh" size={14} color="#60A5FA" />
        )}
        <Text style={{ color: '#60A5FA', fontSize: 12, fontWeight: '800' }}>
          {busy ? 'Проверявам…' : check ? 'Провери отново' : 'Провери цената в магазина сега'}
        </Text>
      </TouchableOpacity>

      {!compact ? (
        <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>
          Проверката чете публичната страница на продукта — не променя офертата.
        </Text>
      ) : null}

      {/* Гост: сверката е позволена, но магазинът се отваря само с профил. */}
      {guest ? (
        <View
          style={{
            gap: 7,
            padding: 9,
            borderRadius: 10,
            backgroundColor: 'rgba(245, 158, 11, 0.10)',
            borderWidth: 1,
            borderColor: 'rgba(245, 158, 11, 0.35)',
          }}
        >
          <Text style={{ color: COLORS.goldBright, fontSize: 11.5, fontWeight: '800' }}>
            {check?.ok
              ? '🔒 Цената е сверена. За да отвориш продукта в магазина, трябва профил.'
              : '🔒 Отварянето на онлайн магазина е само за регистрирани.'}
          </Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>
            Профилът е безплатен и отнема 30 секунди — после отваряш магазина с едно натискане,
            пазиш находки и участваш в томболата.
          </Text>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={onRequireAuth}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 9,
              borderRadius: 10,
              backgroundColor: COLORS.goldPrimary,
            }}
          >
            <Ionicons name="rocket" size={14} color={COLORS.black} />
            <Text style={{ color: COLORS.black, fontSize: 12, fontWeight: '900' }}>
              Регистрирай се, за да продължиш
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};
