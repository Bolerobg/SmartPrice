import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { api, ApiError, uploadImage, type RaffleItem } from '@/src/api/client';

/**
 * Админ панел за томболи.
 *
 * Достъпът се пази на СЪРВЪРА (`ADMIN_EMAILS` / роля admin) — този екран само
 * показва бутоните. Ако сървърът върне 403, тук се вижда ясно съобщение.
 */
export default function AdminRafflesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<RaffleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // форма
  const [title, setTitle] = useState('');
  const [prizeTitle, setPrizeTitle] = useState('');
  const [prizeUrl, setPrizeUrl] = useState('');
  const [prizePrice, setPrizePrice] = useState('');
  const [prizeImage, setPrizeImage] = useState('');
  const [conditionPosts, setConditionPosts] = useState('3');
  const [minParticipants, setMinParticipants] = useState('5');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('20:00');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.adminRaffles();
      setItems(data.items || []);
      setDenied(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      else setNote(err instanceof ApiError ? err.message : 'Грешка при зареждане.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setNote('Няма разрешение за галерията.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]?.uri) return;
    try {
      setBusy(true);
      const url = await uploadImage(res.assets[0].uri);
      setPrizeImage(url);
      setNote('Снимката на наградата е качена ✓');
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Снимката не се качи.');
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(async () => {
    setNote(null);
    if (!title.trim() || !prizeTitle.trim() || !endDate.trim()) {
      setNote('Попълни заглавие, награда и крайна дата (напр. 2026-11-01).');
      return;
    }
    const endsAt = new Date(`${endDate.trim()}T${(endTime || '20:00').trim()}:00`);
    if (Number.isNaN(endsAt.getTime())) {
      setNote('Датата не се разбира. Формат: 2026-11-01 и час 20:00.');
      return;
    }
    setBusy(true);
    try {
      await api.adminCreateRaffle({
        title: title.trim(),
        description: description.trim(),
        prizeTitle: prizeTitle.trim(),
        prizeUrl: prizeUrl.trim() || undefined,
        prizeImageUrl: prizeImage || undefined,
        prizePrice: prizePrice ? Number(prizePrice.replace(',', '.')) : undefined,
        conditionPosts: Number(conditionPosts) || 3,
        minParticipants: Number(minParticipants) || 5,
        countFromStart: true,
        endsAt: endsAt.toISOString(),
        activate: true,
      });
      setTitle('');
      setPrizeTitle('');
      setPrizeUrl('');
      setPrizePrice('');
      setPrizeImage('');
      setDescription('');
      setNote('Томболата е създадена и е активна ✓');
      await load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Томболата не се създаде.');
    } finally {
      setBusy(false);
    }
  }, [conditionPosts, description, endDate, endTime, load, minParticipants, prizeImage, prizePrice, prizeTitle, prizeUrl, title]);

  const setStatus = useCallback(
    async (id: string, status: 'active' | 'running' | 'cancelled') => {
      setBusy(true);
      try {
        await api.adminRaffleStatus(id, status);
        await load();
      } catch (err) {
        setNote(err instanceof ApiError ? err.message : 'Статусът не се смени.');
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const draw = useCallback(
    (id: string) => {
      Alert.alert('Разиграване', 'Да разиграя ли томболата сега? Печели най-бързото време.', [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Разиграй',
          onPress: async () => {
            setBusy(true);
            try {
              const res = await api.adminDrawRaffle(id);
              setNote(
                res.cancelled
                  ? 'Томболата е анулирана — няма достатъчно завършили участници.'
                  : `Победител определен с време ${(res.timeMs ?? 0) / 1000} s ✓`
              );
              await load();
            } catch (err) {
              setNote(err instanceof ApiError ? err.message : 'Разиграването не успя.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]);
    },
    [load]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.greenBright} />
      </View>
    );
  }

  if (denied) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={34} color={COLORS.goldBright} />
        <Text style={styles.deniedText}>
          Този екран е само за администратор. Влез с админ профила (kolyo.hristov@gmail.com).
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.linkText}>Назад</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Админ · Томболи</Text>
        <TouchableOpacity onPress={() => void load()} hitSlop={12}>
          <Ionicons name="refresh" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Нова томбола */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Нова томбола</Text>

        <Text style={styles.label}>Заглавие</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="напр. Томбола „Октомври“" placeholderTextColor={COLORS.textMuted} />

        <Text style={styles.label}>Награда (какво се печели)</Text>
        <TextInput style={styles.input} value={prizeTitle} onChangeText={setPrizeTitle} placeholder="напр. Air Fryer Philips" placeholderTextColor={COLORS.textMuted} />

        <Text style={styles.label}>Линк към продукта</Text>
        <TextInput style={styles.input} value={prizeUrl} onChangeText={setPrizeUrl} placeholder="https://..." placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />

        <Text style={styles.label}>Цена на наградата (€)</Text>
        <TextInput style={styles.input} value={prizePrice} onChangeText={setPrizePrice} placeholder="напр. 149.90" placeholderTextColor={COLORS.textMuted} keyboardType="decimal-pad" />

        <Text style={styles.label}>Снимка на наградата</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => void pickImage()} activeOpacity={0.85} disabled={busy}>
          <Ionicons name="image-outline" size={17} color={COLORS.greenBright} />
          <Text style={styles.secondaryBtnText}>{prizeImage ? 'Смени снимката' : 'Качи снимка'}</Text>
        </TouchableOpacity>
        {prizeImage ? <Image source={{ uri: prizeImage }} style={styles.preview} resizeMode="cover" /> : null}

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Нужни находки</Text>
            <TextInput style={styles.input} value={conditionPosts} onChangeText={setConditionPosts} keyboardType="number-pad" placeholder="3" placeholderTextColor={COLORS.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Мин. участници</Text>
            <TextInput style={styles.input} value={minParticipants} onChangeText={setMinParticipants} keyboardType="number-pad" placeholder="5" placeholderTextColor={COLORS.textMuted} />
          </View>
        </View>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Крайна дата</Text>
            <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="2026-11-01" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Час</Text>
            <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="20:00" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          </View>
        </View>

        <Text style={styles.label}>Описание (по избор)</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Защо тази награда и как се печели"
          placeholderTextColor={COLORS.textMuted}
          multiline
        />

        <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => void create()} disabled={busy} activeOpacity={0.88}>
          <Ionicons name="add-circle" size={17} color={COLORS.black} />
          <Text style={styles.primaryBtnText}>Създай и активирай</Text>
        </TouchableOpacity>
      </View>

      {note ? (
        <View style={styles.noteBox}>
          <Ionicons name="information-circle" size={16} color={COLORS.accentCyan} />
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}

      {/* Съществуващи */}
      {items.map((raffle) => (
        <View key={raffle.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitleFlex} numberOfLines={2}>
              {raffle.title}
            </Text>
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>{raffle.status.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.meta}>
            🎁 {raffle.prize.title} · условие {raffle.conditionPosts} находки · мин. {raffle.minParticipants} участници
          </Text>
          <Text style={styles.meta}>
            Участници: {raffle.entries ?? raffle.qualifiedCount} · краен срок{' '}
            {new Date(raffle.endsAt).toLocaleString('bg-BG')}
          </Text>
          {raffle.winnerId ? <Text style={styles.winner}>Победител е определен ✓</Text> : null}
          {raffle.cancelReason ? <Text style={styles.cancel}>{raffle.cancelReason}</Text> : null}

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.smallBtn} onPress={() => router.push(`/raffle/${raffle.id}` as never)}>
              <Text style={styles.smallBtnText}>Виж</Text>
            </TouchableOpacity>
            {raffle.status === 'draft' ? (
              <TouchableOpacity style={styles.smallBtn} onPress={() => void setStatus(raffle.id, 'active')}>
                <Text style={styles.smallBtnText}>Активирай</Text>
              </TouchableOpacity>
            ) : null}
            {raffle.status === 'active' ? (
              <TouchableOpacity style={styles.smallBtn} onPress={() => void setStatus(raffle.id, 'running')}>
                <Text style={styles.smallBtnText}>Пусни нареждането</Text>
              </TouchableOpacity>
            ) : null}
            {raffle.status === 'running' ? (
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGold]} onPress={() => draw(raffle.id)}>
                <Text style={[styles.smallBtnText, { color: COLORS.black }]}>Разиграй</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 18, paddingTop: 26, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: COLORS.bgPrimary, padding: 24 },
  deniedText: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  linkText: { color: COLORS.accentCyan, fontSize: 13, fontWeight: '800' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '900' },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '900', marginBottom: 6 },
  cardTitleFlex: { flex: 1, color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  statusPill: { backgroundColor: COLORS.bgCardElevated, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  statusText: { color: COLORS.greenBright, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.5 },
  label: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '800', marginTop: 12, marginBottom: 5 },
  input: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 10 },
  preview: { width: '100%', height: 150, borderRadius: 12, marginTop: 10, backgroundColor: COLORS.bgCardElevated },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBright,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 14, fontWeight: '900' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 12,
    paddingVertical: 12,
  },
  secondaryBtnText: { color: COLORS.greenBright, fontSize: 13, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    borderRadius: 12,
    padding: 11,
    marginTop: 12,
  },
  noteText: { flex: 1, color: COLORS.textPrimary, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  meta: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 6, lineHeight: 16 },
  winner: { color: COLORS.greenBright, fontSize: 11.5, fontWeight: '800', marginTop: 6 },
  cancel: { color: COLORS.goldBright, fontSize: 11.5, fontWeight: '700', marginTop: 6 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  smallBtn: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallBtnGold: { backgroundColor: COLORS.goldBright, borderColor: COLORS.goldBright },
  smallBtnText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '800' },
});
