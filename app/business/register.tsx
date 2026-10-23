import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/src/auth/AuthContext';
import {
  ApiError,
  claimBusiness,
  uploadImage,
  type BusinessMine,
} from '@/src/api/client';

/**
 * 🏢 „Това е моят бизнес“ — заявката, с която търговецът влиза в приложението.
 *
 * Защо съществува: досега обектът имаше само гласове на потребители. Когато
 * собственикът заяви обекта си и се провери, той получава право на ОФИЦИАЛЕН
 * отговор под сигналите — чува се и другата страна.
 *
 * Проверката: ако ЕИК съвпадне с ЕИК от вече разчетена касова бележка за СЪЩИЯ
 * обект, системата одобрява веднага (човекът не може да го измисли). Иначе
 * заявката отива при екипа и отговорът идва на посочения имейл.
 */
export default function BusinessRegisterScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const params = useLocalSearchParams<{ slug?: string; name?: string; city?: string }>();
  const slug = String(params.slug || '');

  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [proofUri, setProofUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ business: BusinessMine; message: string } | null>(null);

  const pickProof = async (fromCamera: boolean) => {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Нужно е разрешение за снимки, за да качиш доказателство.');
        return;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
          });
      if (res.canceled) return;
      setProofUri(res.assets[0].uri);
    } catch {
      setError('Не успях да отворя камерата/галерията.');
    }
  };

  const submit = async () => {
    setError('');
    if (!slug) {
      setError('Липсва обект. Отвори обекта от Радара и натисни „Това е моят бизнес“.');
      return;
    }
    if (!isAuthenticated) {
      router.push('/login' as never);
      return;
    }
    if (legalName.trim().length < 2) {
      setError('Напиши името на фирмата (както е по документи).');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Напиши валиден имейл — там ще получим отговор.');
      return;
    }
    const digits = taxId.replace(/\D/g, '');
    if (digits && (digits.length < 9 || digits.length > 13)) {
      setError('ЕИК трябва да е 9 или 13 цифри (или го остави празно).');
      return;
    }

    setBusy(true);
    try {
      let proofUrl: string | undefined;
      if (proofUri) {
        try {
          proofUrl = await uploadImage(proofUri);
        } catch {
          // Без качена снимка заявката пак върви — само проверката е по-бавна.
          proofUrl = undefined;
        }
      }
      const res = await claimBusiness({
        venueSlug: slug,
        legalName: legalName.trim(),
        taxId: digits || undefined,
        contactEmail: email.trim(),
        contactPhone: phone.trim() || undefined,
        proofUrl,
      });
      setDone({ business: res.business, message: res.message });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Не успях да подам заявката. Провери връзката и опитай пак.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const ok = done.business.status === 'verified';
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
              <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Заявката е подадена</Text>
            <View style={{ width: 22 }} />
          </View>

          <View style={[styles.card, ok ? styles.cardGreen : styles.cardGold]}>
            <Ionicons
              name={ok ? 'shield-checkmark' : 'time-outline'}
              size={30}
              color={ok ? COLORS.greenBright : COLORS.goldPrimary}
            />
            <Text style={styles.bigTitle}>
              {ok ? '✅ Проверен търговец' : '⏳ Чака проверка'}
            </Text>
            <Text style={styles.body}>{done.message}</Text>
            <Text style={styles.objLine}>
              🏪 {done.business.place_name}
              {done.business.city ? ` • ${done.business.city}` : ''}
            </Text>
            <Text style={styles.objLine}>🏢 {done.business.legal_name}</Text>
            {done.business.tax_id ? (
              <Text style={styles.objLine}>ЕИК: {done.business.tax_id}</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={() => router.replace('/business/dashboard' as never)}
          >
            <Ionicons name="briefcase-outline" size={16} color={COLORS.onPrimary} />
            <Text style={styles.primaryBtnText}>Виж таблото на бизнеса</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
              <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Това е моят бизнес</Text>
            <View style={{ width: 22 }} />
          </View>

          <View style={styles.heroCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="storefront" size={20} color={COLORS.accentCyan} />
              <Text style={styles.placeName} numberOfLines={2}>
                {String(params.name || 'Обект')}
              </Text>
            </View>
            {params.city ? <Text style={styles.placeSub}>📍 {String(params.city)}</Text> : null}
            <Text style={styles.hint}>
              Ако това е твоят обект, заяви го. След проверка получаваш значка
              „✅ Проверен търговец“ и право на ОФИЦИАЛЕН отговор под всеки сигнал за него —
              хората ще виждат и твоята гледна точка, не само оплакванията.
            </Text>
          </View>

          <Text style={styles.label}>Име на фирмата *</Text>
          <TextInput
            style={styles.input}
            value={legalName}
            onChangeText={setLegalName}
            placeholder="напр. „Храни Иванов“ ЕООД"
            placeholderTextColor={COLORS.textMuted}
            maxLength={160}
          />

          <Text style={styles.label}>ЕИК / Булстат</Text>
          <TextInput
            style={styles.input}
            value={taxId}
            onChangeText={setTaxId}
            placeholder="9 или 13 цифри"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={20}
          />
          <Text style={styles.smallHint}>
            Ако ЕИК съвпадне с касова бележка, която вече е разчетена за този обект,
            одобрението става веднага.
          </Text>

          <Text style={styles.label}>Имейл за връзка *</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="office@firmata.bg"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            maxLength={200}
          />

          <Text style={styles.label}>Телефон (по избор)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+359…"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="phone-pad"
            maxLength={30}
          />

          <Text style={styles.label}>Доказателство (по избор, но ускорява проверката)</Text>
          <Text style={styles.smallHint}>
            Касова бележка, фактура или документ, на който се вижда фирмата и обектът.
          </Text>
          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickProof(true)}>
              <Ionicons name="camera-outline" size={16} color={COLORS.accentCyan} />
              <Text style={styles.photoBtnText}>Снимай</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickProof(false)}>
              <Ionicons name="images-outline" size={16} color={COLORS.accentCyan} />
              <Text style={styles.photoBtnText}>От галерията</Text>
            </TouchableOpacity>
            {proofUri ? (
              <>
                <Image source={{ uri: proofUri }} style={styles.photoThumb} />
                <TouchableOpacity onPress={() => setProofUri('')} hitSlop={10}>
                  <Ionicons name="close-circle" size={20} color={COLORS.redBright ?? COLORS.textMuted} />
                </TouchableOpacity>
              </>
            ) : null}
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={15} color={COLORS.redBright ?? COLORS.textPrimary} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            activeOpacity={0.85}
            disabled={busy}
            onPress={submit}
          >
            {busy ? (
              <ActivityIndicator size="small" color={COLORS.onPrimary} />
            ) : (
              <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.onPrimary} />
            )}
            <Text style={styles.primaryBtnText}>
              {busy ? 'Подавам…' : 'Подай заявката'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.legal}>
            Подавайки заявката, декларираш, че представляваш посочената фирма. Фалшива
            заявка се премахва и профилът се блокира.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  content: { padding: 16, paddingBottom: 44 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  heroCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  placeName: { flex: 1, color: COLORS.textPrimary, fontSize: 18, fontWeight: '900' },
  placeSub: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 6 },
  hint: { color: COLORS.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: 10 },
  smallHint: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: -2, marginBottom: 10 },
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: COLORS.textPrimary,
    fontSize: 14,
    marginBottom: 10,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder ?? COLORS.borderSubtle,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  photoBtnText: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '800' },
  photoThumb: { width: 42, height: 42, borderRadius: 9 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.redSoftBg ?? COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.redBorder ?? COLORS.borderSubtle,
    borderRadius: 12,
    padding: 11,
    marginTop: 14,
  },
  errorText: { flex: 1, color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 18 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 18,
  },
  primaryBtnText: { color: COLORS.onPrimary, fontSize: 14, fontWeight: '900' },
  legal: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 8,
    alignItems: 'flex-start',
  },
  cardGreen: {
    borderColor: COLORS.greenBorder ?? COLORS.borderSubtle,
    backgroundColor: COLORS.greenSoftBg ?? COLORS.bgCard,
  },
  cardGold: {
    borderColor: COLORS.goldBorder ?? COLORS.borderSubtle,
    backgroundColor: COLORS.goldSoftBg ?? COLORS.bgCard,
  },
  bigTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '900' },
  body: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  objLine: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '700' },
});
