import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { CityPickerDropdown } from '@/components/CityPickerDropdown';
import { CATEGORIES, COLORS, PLATFORM_TAGS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import {
  buildGoogleMapsUrl,
  detectUserAndStoreLocation,
  openInGoogleMaps,
} from '@/lib/locationService';
import { CategoryId, PlatformTag, PostPolarity } from '@/types';

interface QuickPricePhotoModalProps {
  visible: boolean;
  initialImageUri?: string | null;
  onClose: () => void;
}

const DEFAULT_FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1542838132-92c53300491e?w=900&auto=format&fit=crop&q=80';

export const QuickPricePhotoModal: React.FC<QuickPricePhotoModalProps> = ({
  visible,
  initialImageUri,
  onClose,
}) => {
  const { addPost } = useApp();

  const [photoUri, setPhotoUri] = useState<string>(
    initialImageUri || DEFAULT_FALLBACK_PHOTO
  );
  const [hasCustomPhoto, setHasCustomPhoto] = useState<boolean>(Boolean(initialImageUri));
  const [polarity, setPolarity] = useState<PostPolarity>('green');
  const [pricePaid, setPricePaid] = useState<string>('');
  const [referencePrice, setReferencePrice] = useState<string>('');
  const [itemTitle, setItemTitle] = useState<string>('');
  const [placeName, setPlaceName] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [city, setCity] = useState<string>('София');
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);
  const [nearbyPlaces, setNearbyPlaces] = useState<string[]>([]);
  const [isDetectingLocation, setIsDetectingLocation] = useState<boolean>(false);
  const [locationDetectedLabel, setLocationDetectedLabel] = useState<string>('');
  const [category, setCategory] = useState<Exclude<CategoryId, 'all'>>('supermarket');
  const [customCategoryLabel, setCustomCategoryLabel] = useState<string>('');
  const [platformTag, setPlatformTag] = useState<PlatformTag>('Супермаркет');
  const [customPlatformLabel, setCustomPlatformLabel] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const runAutoDetectLocation = async (exifData?: Record<string, any> | null) => {
    setIsDetectingLocation(true);
    try {
      const info = await detectUserAndStoreLocation({
        exif: exifData,
        fallbackCity: city,
      });
      setCity(info.city);
      setAddress(info.address);
      setLatitude(info.latitude);
      setLongitude(info.longitude);
      setNearbyPlaces(info.nearbyPlaces);
      if (info.detectedPlaceName) {
        setPlaceName((prev) => prev.trim() || info.detectedPlaceName || '');
      }
      setLocationDetectedLabel(
        info.source === 'photo_exif'
          ? '📍 Локацията е засечена от EXIF метаданните на снимката'
          : '📍 Автоматично засечена GPS локация на магазина'
      );
    } finally {
      setIsDetectingLocation(false);
    }
  };

  useEffect(() => {
    if (initialImageUri) {
      setPhotoUri(initialImageUri);
      setHasCustomPhoto(true);
      runAutoDetectLocation();
    }
  }, [initialImageUri]);

  const isGreen = polarity === 'green';
  const accentColor = isGreen ? COLORS.greenPrimary : COLORS.redPrimary;

  const pickPhoto = async (fromCamera: boolean) => {
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Нужен е достъп до камерата',
            'Моля, разреши достъпа до камерата от настройките на телефона или избери снимка от галерията.'
          );
          return;
        }
        const res = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
          exif: true,
        });
        if (!res.canceled && res.assets[0]?.uri) {
          setPhotoUri(res.assets[0].uri);
          setHasCustomPhoto(true);
          runAutoDetectLocation(res.assets[0].exif);
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Нужен е достъп до галерията',
            'Моля, разреши достъпа до снимките от настройките на телефона.'
          );
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
          exif: true,
        });
        if (!res.canceled && res.assets[0]?.uri) {
          setPhotoUri(res.assets[0].uri);
          setHasCustomPhoto(true);
          runAutoDetectLocation(res.assets[0].exif);
        }
      }
    } catch {
      Alert.alert(
        'Камерата не е достъпна',
        'Избери снимка от галерията или използвай текущата снимка.'
      );
    }
  };

  const handlePublish = async () => {
    const numericPrice = Number(pricePaid.replace(',', '.'));
    if (!pricePaid.trim() || isNaN(numericPrice) || numericPrice <= 0) {
      Alert.alert('Въведи цена', 'Моля, напиши цената от снимката (в лв.).');
      return;
    }
    if (!itemTitle.trim() && !placeName.trim()) {
      Alert.alert(
        'Добави продукт или обект',
        'Напиши какво си снимал (напр. „Кафе + вода“ или името на магазина/ресторанта).'
      );
      return;
    }

    const finalPlace = placeName.trim() || 'Сигнал от потребител';
    const finalAddress = address.trim() || undefined;
    const finalTitle =
      itemTitle.trim() ||
      (isGreen
        ? `Топ цена в ${finalPlace}: ${numericPrice.toFixed(2)} лв.!`
        : `Висока цена в ${finalPlace}: ${numericPrice.toFixed(2)} лв.!`);

    const numericRef =
      referencePrice.trim() !== ''
        ? Number(referencePrice.replace(',', '.'))
        : undefined;

    const mapsUrl = buildGoogleMapsUrl({
      placeName: finalPlace,
      address: finalAddress,
      city,
      latitude,
      longitude,
    });

    const finalPlatform: PlatformTag =
      platformTag === 'Други' && customPlatformLabel.trim()
        ? customPlatformLabel.trim()
        : platformTag;
    const finalCustomCategory =
      category === 'other' && customCategoryLabel.trim()
        ? customCategoryLabel.trim()
        : undefined;

    setIsSubmitting(true);
    try {
      await addPost({
        polarity,
        category,
        customCategoryLabel: finalCustomCategory,
        platformTag: finalPlatform,
        customPlatformLabel:
          platformTag === 'Други' && customPlatformLabel.trim()
            ? customPlatformLabel.trim()
            : undefined,
        title: finalTitle,
        description:
          note.trim() ||
          (isGreen
            ? `Споделена снимка с реална цена (${numericPrice.toFixed(2)} лв.) от ${finalPlace}${finalAddress ? ` (${finalAddress})` : ''}, ${city}.`
            : `Внимание! Снимана цена от ${numericPrice.toFixed(2)} лв. в ${finalPlace}${finalAddress ? ` (${finalAddress})` : ''}, ${city}.`),
        placeName: finalPlace,
        city,
        address: finalAddress,
        latitude,
        longitude,
        googleMapsUrl: mapsUrl,
        locationAutoDetected: Boolean(locationDetectedLabel),
        pricePaid: numericPrice,
        referencePrice: numericRef && !isNaN(numericRef) ? numericRef : undefined,
        imageUri: photoUri,
        tags: [
          '#СнимкаСЦена',
          isGreen ? '#ТопНаходка' : '#ЧервенФлаг',
          `#${city}`,
          `#${finalPlatform.replace(/\s+/g, '')}`,
        ],
      });

      // Нулиране
      setPricePaid('');
      setReferencePrice('');
      setItemTitle('');
      setPlaceName('');
      setAddress('');
      setCustomCategoryLabel('');
      setCustomPlatformLabel('');
      setLatitude(undefined);
      setLongitude(undefined);
      setLocationDetectedLabel('');
      setNote('');
      setHasCustomPhoto(false);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const parsedPrice = Number(pricePaid.replace(',', '.'));
  const parsedRef = Number(referencePrice.replace(',', '.'));
  const diffPercent =
    !isNaN(parsedPrice) &&
    parsedPrice > 0 &&
    !isNaN(parsedRef) &&
    parsedRef > 0
      ? Math.round((Math.abs(parsedRef - parsedPrice) / parsedRef) * 100)
      : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.handleBar} />

          <View style={styles.headerRow}>
            <View style={styles.headerTitleBox}>
              <Ionicons name="camera" size={20} color={COLORS.greenBright} />
              <Text style={styles.headerTitle} numberOfLines={1}>
                Качи снимка с цена
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
          >
            {/* Превю на снимката + бутони за Камера и Галерия */}
            <View style={styles.photoBox}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />

              {/* Горен бадж за статус на снимката */}
              <View style={styles.photoTopBadge}>
                <Ionicons
                  name={hasCustomPhoto ? 'checkmark-circle' : 'image-outline'}
                  size={13}
                  color={hasCustomPhoto ? COLORS.greenBright : COLORS.goldBright}
                />
                <Text style={styles.photoTopBadgeText}>
                  {hasCustomPhoto ? 'Твоя снимка е прикачена' : 'Снимай етикет, меню или продукт'}
                </Text>
              </View>

              {/* Жив ценови етикет върху самата снимка */}
              <View
                style={[
                  styles.livePriceStamp,
                  { borderColor: isGreen ? COLORS.greenBorder : COLORS.redBorder },
                ]}
              >
                <View>
                  <Text style={styles.livePriceLabel}>
                    {isGreen ? '🟢 ДОБРА ЦЕНА' : '🔴 ВИСОКА ЦЕНА / КАПАН'}
                  </Text>
                  <Text style={[styles.livePriceValue, { color: accentColor }]}>
                    {!isNaN(parsedPrice) && parsedPrice > 0
                      ? `${parsedPrice.toFixed(2)} лв.`
                      : '0.00 лв.'}
                  </Text>
                </View>
                {diffPercent !== null && (
                  <View
                    style={[
                      styles.liveDiffBadge,
                      { backgroundColor: accentColor },
                    ]}
                  >
                    <Text style={styles.liveDiffText}>
                      {isGreen ? `-${diffPercent}%` : `+${diffPercent}%`}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Големи бутони за снимане или избор от галерия */}
            <View style={styles.pickerRow}>
              <TouchableOpacity
                style={styles.cameraBtn}
                onPress={() => pickPhoto(true)}
                activeOpacity={0.85}
              >
                <Ionicons name="camera" size={18} color={COLORS.black} />
                <Text style={styles.cameraBtnText}>Снимай с Камера</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.galleryBtn}
                onPress={() => pickPhoto(false)}
                activeOpacity={0.85}
              >
                <Ionicons name="images" size={18} color={COLORS.textPrimary} />
                <Text style={styles.galleryBtnText}>От Галерия</Text>
              </TouchableOpacity>
            </View>

            {/* Тип: Оферта или Капан */}
            <View style={styles.polarityRow}>
              <TouchableOpacity
                style={[
                  styles.polarityOption,
                  isGreen && styles.polarityOptionGreen,
                ]}
                onPress={() => setPolarity('green')}
              >
                <Text
                  style={[
                    styles.polarityOptionText,
                    isGreen && { color: COLORS.greenBright, fontWeight: '800' },
                  ]}
                  numberOfLines={1}
                >
                  🟢 Изгодна цена
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.polarityOption,
                  !isGreen && styles.polarityOptionRed,
                ]}
                onPress={() => setPolarity('red')}
              >
                <Text
                  style={[
                    styles.polarityOptionText,
                    !isGreen && { color: COLORS.redBright, fontWeight: '800' },
                  ]}
                  numberOfLines={1}
                >
                  🔴 Висока цена / Капан
                </Text>
              </TouchableOpacity>
            </View>

            {/* Полета за цена */}
            <View style={styles.priceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Цена от снимката (лв.) *</Text>
                <TextInput
                  style={[
                    styles.priceInputBig,
                    { borderColor: accentColor, color: accentColor },
                  ]}
                  placeholder="напр. 12.90"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="decimal-pad"
                  value={pricePaid}
                  onChangeText={setPricePaid}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>
                  {isGreen ? 'Стара/нормална (лв.)' : 'Реална цена (лв.)'}
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="по избор"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="decimal-pad"
                  value={referencePrice}
                  onChangeText={setReferencePrice}
                />
              </View>
            </View>

            {/* Какво е снимано + Обект */}
            <Text style={styles.inputLabel}>Какво има на снимката? *</Text>
            <TextInput
              style={styles.input}
              placeholder="напр. Зехтин 1л / Мешана скара 400г / Вода 330мл..."
              placeholderTextColor={COLORS.textMuted}
              value={itemTitle}
              onChangeText={setItemTitle}
            />

            {/* Автоматична локация на магазина + Google Maps */}
            <View
              style={{
                backgroundColor: COLORS.bgCard,
                borderWidth: 1,
                borderColor: locationDetectedLabel
                  ? COLORS.greenBorder
                  : COLORS.borderStrong,
                borderRadius: 14,
                padding: 11,
                marginBottom: 12,
                gap: 8,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <Ionicons
                    name="navigate-circle"
                    size={18}
                    color={COLORS.greenBright}
                  />
                  <Text
                    style={{
                      color: COLORS.textPrimary,
                      fontSize: 12.5,
                      fontWeight: '800',
                      flex: 1,
                    }}
                    numberOfLines={2}
                  >
                    {isDetectingLocation
                      ? '🛰️ Автоматично засичане на магазин и адрес...'
                      : locationDetectedLabel ||
                        '📍 Засечи автоматично магазина и адреса по GPS'}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => runAutoDetectLocation()}
                  disabled={isDetectingLocation}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: COLORS.greenSoftBg,
                    borderWidth: 1,
                    borderColor: COLORS.greenBorder,
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderRadius: 10,
                  }}
                >
                  {isDetectingLocation ? (
                    <ActivityIndicator size="small" color={COLORS.greenBright} />
                  ) : (
                    <>
                      <Ionicons name="locate" size={13} color={COLORS.greenBright} />
                      <Text
                        style={{
                          color: COLORS.greenBright,
                          fontSize: 11,
                          fontWeight: '800',
                        }}
                      >
                        GPS Локация
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {nearbyPlaces.length > 0 && (
                <View>
                  <Text
                    style={{
                      color: COLORS.textMuted,
                      fontSize: 11,
                      fontWeight: '700',
                      marginBottom: 5,
                    }}
                  >
                    Близки засечени обекти (1 клик):
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6 }}
                  >
                    {nearbyPlaces.map((pName) => {
                      const active = placeName === pName;
                      return (
                        <TouchableOpacity
                          key={pName}
                          onPress={() => setPlaceName(pName)}
                          style={{
                            backgroundColor: active
                              ? COLORS.greenSoftBg
                              : COLORS.bgCardElevated,
                            borderWidth: 1,
                            borderColor: active
                              ? COLORS.greenPrimary
                              : COLORS.borderSubtle,
                            borderRadius: 9,
                            paddingHorizontal: 9,
                            paddingVertical: 5,
                          }}
                        >
                          <Text
                            style={{
                              color: active
                                ? COLORS.greenBright
                                : COLORS.textSecondary,
                              fontSize: 11.5,
                              fontWeight: active ? '800' : '600',
                            }}
                          >
                            🏪 {pName}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <Text style={[styles.inputLabel, { marginBottom: 2 }]}>
                Магазин / Ресторант / Хотел *
              </Text>
              <TextInput
                style={[styles.input, { marginBottom: 4 }]}
                placeholder="напр. Kaufland / Ресторант Морски Бриз / Airbnb..."
                placeholderTextColor={COLORS.textMuted}
                value={placeName}
                onChangeText={setPlaceName}
              />

              <Text style={[styles.inputLabel, { marginBottom: 2 }]}>
                Точен адрес в Google Maps (автоматично засечен):
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholder="напр. бул. Витоша 89, Център"
                  placeholderTextColor={COLORS.textMuted}
                  value={address}
                  onChangeText={setAddress}
                />
                <TouchableOpacity
                  onPress={() =>
                    openInGoogleMaps({
                      placeName: placeName || 'Магазин',
                      address,
                      city,
                      latitude,
                      longitude,
                    })
                  }
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.16)',
                    borderWidth: 1,
                    borderColor: 'rgba(59, 130, 246, 0.45)',
                    borderRadius: 12,
                    paddingHorizontal: 10,
                    paddingVertical: 11,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Ionicons name="map" size={15} color="#60A5FA" />
                  <Text
                    style={{
                      color: '#60A5FA',
                      fontSize: 11.5,
                      fontWeight: '800',
                    }}
                  >
                    Карта
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Категория (Гъвкава мрежа + Потребителско описание при "Други") */}
            <Text style={styles.inputLabel}>Категория:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {CATEGORIES.filter((c) => c.id !== 'all').map((cat) => {
                const active = category === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.chip,
                      active && {
                        backgroundColor: accentColor,
                        borderColor: accentColor,
                      },
                    ]}
                    onPress={() =>
                      setCategory(cat.id as Exclude<CategoryId, 'all'>)
                    }
                  >
                    <Ionicons
                      name={cat.icon as any}
                      size={13}
                      color={active ? COLORS.white : COLORS.textSecondary}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        active && { color: COLORS.white, fontWeight: '800' },
                      ]}
                    >
                      {cat.shortLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {category === 'other' && (
              <TextInput
                style={styles.input}
                placeholder="Опиши категорията (напр. Аптека, Бензиностанция, Автосервиз...)"
                placeholderTextColor={COLORS.textMuted}
                value={customCategoryLabel}
                onChangeText={setCustomCategoryLabel}
              />
            )}

            {/* Платформа / Начин на покупка (Гъвкава мрежа + Потребителско описание при "Други") */}
            <Text style={styles.inputLabel}>Платформа / Начин на покупка:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {PLATFORM_TAGS.map((tag) => {
                const active = platformTag === tag;
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.chip,
                      active && {
                        backgroundColor: COLORS.accentIndigo,
                        borderColor: COLORS.accentIndigo,
                      },
                    ]}
                    onPress={() => setPlatformTag(tag)}
                  >
                    {tag === 'Други' && (
                      <Ionicons
                        name="add-circle-outline"
                        size={13}
                        color={active ? COLORS.white : COLORS.textSecondary}
                      />
                    )}
                    <Text
                      style={[
                        styles.chipText,
                        active && { color: COLORS.white, fontWeight: '800' },
                      ]}
                    >
                      {tag}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {platformTag === 'Други' && (
              <TextInput
                style={styles.input}
                placeholder="Опиши платформата (напр. Glovo, Takeaway, OLX, Instagram, Пазар...)"
                placeholderTextColor={COLORS.textMuted}
                value={customPlatformLabel}
                onChangeText={setCustomPlatformLabel}
              />
            )}

            <View style={{ marginBottom: 10 }}>
              <CityPickerDropdown
                selectedCity={city}
                onSelectCity={setCity}
                includeAllOption={false}
                label="Град в България:"
                accentColor={accentColor}
              />
            </View>

            <Text style={styles.inputLabel}>Кратък коментар (по избор):</Text>
            <TextInput
              style={styles.input}
              placeholder="Допълнителни детайли за цената или грамажа..."
              placeholderTextColor={COLORS.textMuted}
              value={note}
              onChangeText={setNote}
            />

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: accentColor }]}
              onPress={handlePublish}
              disabled={isSubmitting}
              activeOpacity={0.88}
            >
              {isSubmitting ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={19} color={COLORS.white} />
                  <Text style={styles.submitBtnText}>
                    Публикувай снимката с цена
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 14, 0.85)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bgSecondary,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    maxHeight: '92%',
  },
  handleBar: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.borderStrong,
    alignSelf: 'center',
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  closeBtn: {
    padding: 4,
  },
  scrollBody: {
    paddingBottom: 16,
  },
  photoBox: {
    height: 185,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.bgCard,
    position: 'relative',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  photoTopBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(9, 13, 22, 0.85)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
  },
  photoTopBadgeText: {
    color: COLORS.textPrimary,
    fontSize: 10.5,
    fontWeight: '700',
  },
  livePriceStamp: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(9, 13, 22, 0.92)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  livePriceLabel: {
    color: COLORS.textSecondary,
    fontSize: 9.5,
    fontWeight: '800',
  },
  livePriceValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  liveDiffBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveDiffText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '900',
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  cameraBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.greenBright,
    paddingVertical: 11,
    borderRadius: 12,
  },
  cameraBtnText: {
    color: COLORS.black,
    fontSize: 13,
    fontWeight: '900',
  },
  galleryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingVertical: 11,
    borderRadius: 12,
  },
  galleryBtnText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  polarityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  polarityOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  polarityOptionGreen: {
    backgroundColor: COLORS.greenSoftBg,
    borderColor: COLORS.greenPrimary,
  },
  polarityOptionRed: {
    backgroundColor: COLORS.redSoftBg,
    borderColor: COLORS.redPrimary,
  },
  polarityOptionText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  inputLabel: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 5,
    marginTop: 6,
  },
  priceInputBig: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '900',
  },
  input: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 13.5,
  },
  chipsScroll: {
    gap: 6,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 14,
  },
  submitBtnText: {
    color: COLORS.white,
    fontSize: 14.5,
    fontWeight: '900',
  },
});
