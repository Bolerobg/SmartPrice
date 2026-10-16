import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { api } from '@/src/api/client';

/**
 * Победителят дава данни за доставка на наградата.
 *
 * Защо е в приложението, а не по имейл: тук човекът е влязъл, знаем кой е, и
 * данните влизат директно в панела — без преписани адреси и изгубени писма.
 * Показва се САМО на победителя и само докато не е дал адрес.
 */
export const RaffleClaimModal: React.FC<{
  raffleId: string;
  visible: boolean;
  defaultName?: string;
  defaultCity?: string;
  deliveryNote?: string;
  claimDeadlineDays?: number;
  onClose: () => void;
  onDone: () => void;
}> = ({ raffleId, visible, defaultName, defaultCity, deliveryNote, claimDeadlineDays, onClose, onDone }) => {
  const [name, setName] = useState(defaultName ?? '');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState(defaultCity ?? '');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (name.trim().length < 2) return setError('Напиши име на получателя.');
    if (phone.trim().length < 6) return setError('Телефонът е твърде къс — куриерът ще звъни.');
    if (city.trim().length < 2) return setError('Напиши град.');
    if (address.trim().length < 5) return setError('Напиши адрес или офис на куриер.');
    setBusy(true);
    setError(null);
    try {
      await api.raffleClaim(raffleId, {
        name: name.trim(),
        phone: phone.trim(),
        city: city.trim(),
        address: address.trim(),
        note: note.trim() || undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не се получи. Опитай пак.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.head}>
              <View style={styles.iconWrap}>
                <Ionicons name="gift" size={22} color={COLORS.black} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Спечели! Къде да пратим наградата?</Text>
                <Text style={styles.sub}>
                  Данните се виждат само от екипа — нужни са на куриера.
                  {claimDeadlineDays ? ` Дай ги до ${claimDeadlineDays} дни.` : ''}
                </Text>
              </View>
            </View>

            <Text style={styles.label}>Име и фамилия на получателя</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Иван Иванов" placeholderTextColor={COLORS.textMuted} />

            <Text style={styles.label}>Телефон</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0888 123 456" placeholderTextColor={COLORS.textMuted} />

            <Text style={styles.label}>Град</Text>
            <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="София" placeholderTextColor={COLORS.textMuted} />

            <Text style={styles.label}>Адрес (или офис на куриер)</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={address}
              onChangeText={setAddress}
              multiline
              placeholder="кв. Лозенец, ул. „Примерна“ 12, ет. 3, ап. 7 — или: офис на Еконт, ул. „Витоша“ 5"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.label}>Бележка (по избор)</Text>
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Звънни преди доставка" placeholderTextColor={COLORS.textMuted} />

            {deliveryNote ? (
              <View style={styles.noteBox}>
                <Ionicons name="information-circle" size={15} color={COLORS.accentCyan} />
                <Text style={styles.noteText}>{deliveryNote}</Text>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={styles.primary} onPress={() => void submit()} activeOpacity={0.9} disabled={busy}>
              {busy ? (
                <ActivityIndicator color={COLORS.black} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.black} />
                  <Text style={styles.primaryText}>Изпрати данните</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.later} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.laterText}>По-късно</Text>
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(4,7,15,0.85)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.bgCard,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    padding: 20,
    maxHeight: '90%',
  },
  head: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 14 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.goldBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '900' },
  sub: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  label: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.bgPrimary,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  inputMulti: { minHeight: 76, textAlignVertical: 'top' },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: COLORS.accentCyanSoftBg,
  },
  noteText: { color: COLORS.textSecondary, fontSize: 12.5, flex: 1, lineHeight: 18 },
  error: { color: COLORS.redBright, fontSize: 13, fontWeight: '700', marginTop: 12 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.goldBright,
  },
  primaryText: { color: COLORS.black, fontSize: 15, fontWeight: '900' },
  later: { alignItems: 'center', paddingVertical: 13 },
  laterText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
});
