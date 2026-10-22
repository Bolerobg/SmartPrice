import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
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
import { api, uploadImage, type ListingConfigPublic } from '@/src/api/client';

/**
 * 🏷️ ПУСКАНЕ НА ОБЯВА (платена).
 *
 * Стъпки пред човека: 1) попълва, 2) качва до 5 снимки, 3) плаща 2 € и обявата
 * излиза веднага за 60 дни. Всичко е на един екран — без да го караме да се лута.
 *
 * Ако е дошъл от чернова (`?id=…`), попълваме полетата и той само довършва.
 */

const MAX = 5;

export default function NewListingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [cfg, setCfg] = useState<ListingConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  // Полетата
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [negotiable, setNegotiable] = useState(false);
  const [category, setCategory] = useState('other');
  const [condition, setCondition] = useState('used');
  const [handover, setHandover] = useState('pickup');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [phone, setPhone] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [listingId, setListingId] = useState<string>(id ?? '');
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const conf = await api.listingConfig();
        setCfg(conf);
        if (id) {
          const { listing } = await api.listing(id);
          setTitle(listing.title);
          setDescription(listing.description ?? '');
          setPrice(listing.price_eur != null ? String(listing.price_eur) : '');
          setIsFree(listing.is_free);
          setNegotiable(listing.is_negotiable);
          setCategory(listing.category);
          setCondition(listing.item_condition);
          setHandover(listing.handover);
          setCity(listing.city);
          setNeighborhood(listing.neighborhood ?? '');
          setPhone(listing.contact_phone ?? '');
          setContactNote(listing.contact_note ?? '');
          setImages(listing.images ?? []);
        }
      } catch (err) {
        setNote((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /** Избор на снимки — до 5 общо. Веднага ги качваме, за да е сигурно. */
  const pickImages = async () => {
    if (images.length >= MAX) {
      setNote(`Най-много ${MAX} снимки. Махни една, за да сложиш друга.`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setNote('Нужно е разрешение за снимките, за да качиш снимка на стоката.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX - images.length,
      quality: 0.85,
    });
    if (res.canceled) return;
    setBusy('upload');
    try {
      const uploaded: string[] = [];
      for (const asset of res.assets.slice(0, MAX - images.length)) {
        uploaded.push(await uploadImage(asset.uri));
      }
      setImages((prev) => [...prev, ...uploaded].slice(0, MAX));
    } catch (err) {
      setNote(`Снимката не се качи: ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const removeImage = (url: string) => setImages((prev) => prev.filter((u) => u !== url));

  const stepOne = async (): Promise<string | null> => {
    if (title.trim().length < 6) {
      setNote('Заглавието трябва да е поне 6 знака — напиши какво продаваш.');
      return null;
    }
    if (city.trim().length < 2) {
      setNote('Напиши града, за да те намерят купувачите.');
      return null;
    }
    if (!isFree && !(Number(price) > 0)) {
      setNote('Напиши цена или отбележи „Подарявам“.');
      return null;
    }
    if (images.length === 0) {
      setNote('Сложи поне една снимка — обяви без снимка почти не се отварят.');
      return null;
    }
    const body = {
      title: title.trim(),
      description: description.trim(),
      priceEur: isFree ? null : Number(price),
      isFree,
      isNegotiable: negotiable,
      category,
      city: city.trim(),
      neighborhood: neighborhood.trim() || null,
      itemCondition: condition,
      handover,
      contactPhone: phone.trim() || null,
      contactNote: contactNote.trim() || null,
      images,
    };
    if (listingId) {
      const { listing } = await api.updateListing(listingId, body);
      return listing.id;
    }
    const { listing } = await api.createListing(body);
    setListingId(listing.id);
    return listing.id;
  };

  /** Плащане: отваряме Stripe и после проверяваме дали е минало. */
  const pay = async () => {
    setBusy('pay');
    setNote('');
    try {
      const newId = await stepOne();
      if (!newId) return;
      const co = await api.listingCheckout(newId, 'publish');
      setSessionId(co.sessionId);
      if (co.checkoutUrl) await Linking.openURL(co.checkoutUrl);
      setNote(
        `Плащаш ${co.amountEur.toFixed(2)} € за 60 дни. Плати в браузъра и се върни тук — натисни „Провери плащането“.`
      );
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const confirm = async () => {
    if (!sessionId) return;
    setBusy('confirm');
    try {
      const res = await api.confirmListingPayment(sessionId);
      if (res.ok) {
        setNote('Готово! Обявата е активна и вече се вижда от хората. 🎉');
        setTimeout(() => router.replace('/listings' as never), 1200);
      } else {
        setNote(res.reason || 'Плащането още не е пристигнало.');
      }
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (loading || !cfg) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.greenPrimary} />
        <Text style={styles.muted}>Зареждам…</Text>
      </SafeAreaView>
    );
  }

  const chips = <T extends { id: string; label: string }>(
    list: T[],
    value: string,
    onPick: (id: string) => void
  ) => (
    <View style={styles.chips}>
      {list.map((c) => (
        <TouchableOpacity
          key={c.id}
          onPress={() => onPick(c.id)}
          style={[styles.chip, value === c.id && styles.chipActive]}
        >
          <Text style={[styles.chipText, value === c.id && styles.chipTextActive]}>{c.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBack(router)} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Пусни обява</Text>
          <View style={{ width: 34 }} />
        </View>

        {/* Цената и срокът — още отгоре, за да няма изненади накрая. */}
        <View style={[styles.card, styles.priceCard]}>
          <Text style={styles.priceLine}>
            <Text style={styles.priceBig}>{cfg.priceEur.toFixed(2)} €</Text> за {cfg.days} дни
          </Text>
          <Text style={styles.hint}>
            Плаща се веднъж. Обявата стои {cfg.days} дни и се вижда от всички. Спираш я с едно натискане, когато
            продадеш.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>1️⃣ Снимки ({images.length}/{cfg.maxImages})</Text>
          <View style={styles.thumbs}>
            {images.map((url) => (
              <View key={url} style={styles.thumbWrap}>
                <Image source={{ uri: url }} style={styles.thumb} />
                <TouchableOpacity style={styles.thumbX} onPress={() => removeImage(url)}>
                  <Ionicons name="close" size={13} color={COLORS.black} />
                </TouchableOpacity>
              </View>
            ))}
            {images.length < cfg.maxImages ? (
              <TouchableOpacity style={styles.addThumb} onPress={() => void pickImages()} disabled={busy === 'upload'}>
                {busy === 'upload' ? (
                  <ActivityIndicator color={COLORS.greenBright} />
                ) : (
                  <>
                    <Ionicons name="camera" size={20} color={COLORS.greenBright} />
                    <Text style={styles.addThumbText}>Добави</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.hint}>
            Първата снимка е като корица. Прави снимки на светло — така продаваш по-бързо.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>2️⃣ Какво продаваш</Text>
          <Text style={styles.label}>Заглавие</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="напр. Детско колело Puky 16 цола"
            placeholderTextColor={COLORS.textMuted}
            maxLength={120}
          />
          <Text style={styles.label}>Описание</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Състояние, откога го имаш, защо продаваш…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={2000}
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Цена (€)</Text>
              <TextInput
                style={[styles.input, isFree && styles.inputOff]}
                value={isFree ? '' : price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                editable={!isFree}
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Подарявам</Text>
              <Switch
                value={isFree}
                onValueChange={(v) => {
                  setIsFree(v);
                  if (v) setPrice('');
                }}
                trackColor={{ true: COLORS.greenPrimary, false: COLORS.borderStrong }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Пазарлък</Text>
              <Switch
                value={negotiable}
                onValueChange={setNegotiable}
                trackColor={{ true: COLORS.greenPrimary, false: COLORS.borderStrong }}
              />
            </View>
          </View>

          <Text style={styles.label}>Категория</Text>
          {chips(cfg.choices.categories, category, setCategory)}
          <Text style={styles.label}>Състояние</Text>
          {chips(cfg.choices.conditions, condition, setCondition)}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>3️⃣ Къде и как</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Град</Text>
              <TextInput
                style={styles.input}
                value={city}
                onChangeText={setCity}
                placeholder="София"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Квартал (по избор)</Text>
              <TextInput
                style={styles.input}
                value={neighborhood}
                onChangeText={setNeighborhood}
                placeholder="Лозенец"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>
          <Text style={styles.label}>Как предаваш</Text>
          {chips(cfg.choices.handovers, handover, setHandover)}
          <Text style={styles.label}>Телефон (по избор)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+359…"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="phone-pad"
          />
          <Text style={styles.label}>Бележка за купувача (по избор)</Text>
          <TextInput
            style={styles.input}
            value={contactNote}
            onChangeText={setContactNote}
            placeholder="напр. Мога да го донеса в центъра в събота"
            placeholderTextColor={COLORS.textMuted}
            maxLength={300}
          />
        </View>

        {note ? (
          <View style={styles.card}>
            <Text style={styles.noteText}>{note}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryBtn, busy !== '' && { opacity: 0.6 }]}
          onPress={() => void (sessionId ? confirm() : pay())}
          disabled={busy !== ''}
        >
          {busy ? (
            <ActivityIndicator color={COLORS.black} />
          ) : (
            <Text style={styles.primaryBtnText}>
              {sessionId ? '✅ Провери плащането' : `💳 Плати ${cfg.priceEur.toFixed(2)} € и пусни`}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={styles.hint}>
          Обявата не се вижда, докато не платиш. След плащането тръгва веднага и получаваш потвърждение.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 16, paddingBottom: 50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgPrimary, gap: 10 },
  muted: { color: COLORS.textSecondary, fontSize: 13.5 },
  hint: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  headerTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    marginBottom: 12,
  },
  priceCard: { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: COLORS.greenBorder },
  priceLine: { color: COLORS.textPrimary, fontSize: 15 },
  priceBig: { fontSize: 24, fontWeight: '900', color: COLORS.greenBright },
  cardTitle: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '800', marginBottom: 10 },
  label: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700', marginTop: 10, marginBottom: 5 },
  input: {
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    color: COLORS.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14.5,
  },
  inputOff: { opacity: 0.4 },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  thumbWrap: { width: 74, height: 74 },
  thumb: { width: 74, height: 74, borderRadius: 12, backgroundColor: COLORS.bgCardElevated },
  thumbX: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.goldPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addThumb: {
    width: 74,
    height: 74,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addThumbText: { color: COLORS.greenBright, fontSize: 10.5, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    backgroundColor: COLORS.bgCardElevated,
  },
  chipActive: { borderColor: COLORS.greenBorder, backgroundColor: 'rgba(34,197,94,0.14)' },
  chipText: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700' },
  chipTextActive: { color: COLORS.greenBright },
  noteText: { color: COLORS.textPrimary, fontSize: 13.5, lineHeight: 19 },
  primaryBtn: {
    marginTop: 4,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: COLORS.greenPrimary,
  },
  primaryBtnText: { color: COLORS.onPrimary, fontSize: 15, fontWeight: '900' },
});
