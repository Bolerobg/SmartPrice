import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useRouter } from 'expo-router';
import { CityPickerDropdown } from '@/components/CityPickerDropdown';
import { ReceiptModalCard } from '@/components/ReceiptModalCard';
import { CATEGORIES, COLORS, PLATFORM_TAGS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import {
  buildGoogleMapsUrl,
  detectUserAndStoreLocation,
  openInGoogleMaps,
} from '@/lib/locationService';
import { analyzeReceiptImage } from '@/services/receiptOcr';
import { CategoryId, PlatformTag, PostPolarity, ReceiptData } from '@/types';

const SAMPLE_PHOTOS: Record<Exclude<CategoryId, 'all'>, string> = {
  restaurants:
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=900&auto=format&fit=crop&q=80',
  hotels_airbnb:
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=900&auto=format&fit=crop&q=80',
  supermarket:
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=900&auto=format&fit=crop&q=80',
  cafes_bars:
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=900&auto=format&fit=crop&q=80',
  services_tech:
    'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=900&auto=format&fit=crop&q=80',
  other:
    'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=900&auto=format&fit=crop&q=80',
};

const QUICK_CUSTOM_PLATFORMS = [
  'Glovo',
  'Takeaway',
  'eMAG',
  'OLX / Bazar.bg',
  'Instagram / Facebook',
  'Фермерски пазар',
  'Куриер (Еконт / Спиди)',
  'По телефон',
];

const QUICK_CUSTOM_CATEGORIES = [
  'Аптека / Лекарства',
  'Бензиностанция / Горива',
  'Автосервиз / Части',
  'Салон за красота',
  'Фитнес / Спорт',
  'Строителство / Ремонт',
  'Събития / Билети',
  'Дрехи и Обувки',
];

export default function AddPostScreen() {
  const router = useRouter();
  const { addPost } = useApp();

  const [polarity, setPolarity] = useState<PostPolarity>('green');
  const [category, setCategory] = useState<Exclude<CategoryId, 'all'>>('restaurants');
  const [customCategoryLabel, setCustomCategoryLabel] = useState<string>('');
  const [platformTag, setPlatformTag] = useState<PlatformTag>('На място');
  const [customPlatformLabel, setCustomPlatformLabel] = useState<string>('');
  const [city, setCity] = useState<string>('София');
  const [placeName, setPlaceName] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);
  const [nearbyPlaces, setNearbyPlaces] = useState<string[]>([]);
  const [isDetectingLocation, setIsDetectingLocation] = useState<boolean>(false);
  const [locationDetectedLabel, setLocationDetectedLabel] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [pricePaid, setPricePaid] = useState<string>('');
  const [referencePrice, setReferencePrice] = useState<string>('');
  const [unitQuantity, setUnitQuantity] = useState<string>('');
  const [unitType, setUnitType] = useState<'g' | 'kg' | 'ml' | 'l' | 'pcs'>('g');
  const [isShrinkflation, setIsShrinkflation] = useState<boolean>(false);
  const [isFakePromo, setIsFakePromo] = useState<boolean>(false);
  const [imageUri, setImageUri] = useState<string>(SAMPLE_PHOTOS.restaurants);
  const [comparisonImageUri, setComparisonImageUri] = useState<string>('');

  const [hasUserPhoto, setHasUserPhoto] = useState<boolean>(false);
  const [scannedReceipt, setScannedReceipt] = useState<ReceiptData | undefined>(undefined);
  const [isScanningReceipt, setIsScanningReceipt] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isGreen = polarity === 'green';
  const accentColor = isGreen ? COLORS.greenPrimary : COLORS.redPrimary;

  const triggerAutoLocation = async (exifData?: Record<string, any> | null) => {
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
        !info.hasRealCoordinates
          ? '📍 Няма GPS достъп — градът е предположен, провери го'
          : info.source === 'photo_exif'
            ? '📍 Засечено от EXIF локацията на снимката'
            : info.detectedPlaceName
              ? '📍 Засечен обект и адрес по GPS'
              : '📍 Засечен адрес по GPS (обектът не е разпознат)'
      );
    } finally {
      setIsDetectingLocation(false);
    }
  };

  const pickMainImage = async (fromCamera: boolean) => {
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Достъп до камерата',
            'Моля, разреши достъпа до камерата от настройките на телефона или избери снимка от галерията.'
          );
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
          exif: true,
        });
        if (!result.canceled && result.assets[0]?.uri) {
          setImageUri(result.assets[0].uri);
          setHasUserPhoto(true);
          triggerAutoLocation(result.assets[0].exif);
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Достъп до галерията',
            'Моля, разреши достъпа до снимките от настройките на телефона.'
          );
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
          exif: true,
        });
        if (!result.canceled && result.assets[0]?.uri) {
          setImageUri(result.assets[0].uri);
          setHasUserPhoto(true);
          triggerAutoLocation(result.assets[0].exif);
        }
      }
    } catch {
      Alert.alert(
        'Камера / Галерия',
        'Избери снимка от галерията или използвай примерната снимка.'
      );
    }
  };

  const pickComparisonImage = async (fromCamera: boolean) => {
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        });
        if (!result.canceled && result.assets[0]?.uri) {
          setComparisonImageUri(result.assets[0].uri);
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        });
        if (!result.canceled && result.assets[0]?.uri) {
          setComparisonImageUri(result.assets[0].uri);
        }
      }
    } catch {
      // Игнориране при липса на камера в симулатор
    }
  };

  const handleScanReceipt = async (mode: 'demo' | 'camera' | 'gallery') => {
    let selectedReceiptUri =
      'https://images.unsplash.com/photo-1554415707-c18c60fe62a0?w=700&auto=format&fit=crop&q=80';
    let base64: string | undefined;

    if (mode === 'camera' || mode === 'gallery') {
      try {
        if (mode === 'camera') {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return;
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) return;
        }

        const res =
          mode === 'camera'
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.75,
                base64: true,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.75,
                base64: true,
              });

        if (res.canceled || !res.assets[0]) {
          return;
        }
        selectedReceiptUri = res.assets[0].uri;
        base64 = res.assets[0].base64 || undefined;
      } catch {
        // Продължаваме с демо касовата бележка
      }
    }

    setIsScanningReceipt(true);
    try {
      const extracted = await analyzeReceiptImage({
        imageUri: selectedReceiptUri,
        category,
        polarity,
      });

      setScannedReceipt(extracted);

      // Автоматично попълване на полетата от касовата бележка
      if (!placeName.trim()) {
        setPlaceName(extracted.merchantName);
      }
      setPricePaid(String(extracted.totalAmount));
      // ВАЖНО: не измисляме „стара/обичайна цена“. Преди кодът слагаше
      // totalAmount × 1.65 и после показваше фалшива оценка на спестяване.
      // Референсната цена се попълва само от потребителя.
      if (!title.trim()) {
        const firstItem = extracted.items[0]?.name || 'Продукт';
        setTitle(
          polarity === 'green'
            ? `Супер находка: ${firstItem} за общо ${extracted.totalAmount.toFixed(2)} лв.!`
            : `Внимание в ${extracted.merchantName}: ${extracted.totalAmount.toFixed(2)} лв. сметка!`
        );
      }
      if (!description.trim()) {
        const summaryLines = extracted.items
          .map((i) => `${i.name} (${i.totalPrice.toFixed(2)} лв.)`)
          .join(', ');
        setDescription(
          polarity === 'green'
            ? `Проверено на място с касова бележка! Включва: ${summaryLines}. Отлично качество спрямо цената.`
            : `Споделям касовата бележка, за да предпазя други потребители. Начислени артикули: ${summaryLines}.`
        );
      }
    } finally {
      setIsScanningReceipt(false);
    }
  };

  const handlePublish = async () => {
    const numericPrice = Number(pricePaid.replace(',', '.'));
    if (!pricePaid.trim() || isNaN(numericPrice) || numericPrice <= 0) {
      Alert.alert(
        'Въведи цена',
        'Моля, въведи платената цена (или използвай AI скенера на касова бележка)!'
      );
      return;
    }

    if (!title.trim() && !placeName.trim()) {
      Alert.alert(
        'Липсваща информация',
        'Моля, напиши име на обекта/мястото или заглавие към снимката с цена!'
      );
      return;
    }

    const finalPlace = placeName.trim() || 'Споделено от потребител';
    const finalAddress = address.trim() || undefined;
    const finalTitle =
      title.trim() ||
      (isGreen
        ? `Топ цена в ${finalPlace}: ${numericPrice.toFixed(2)} лв.!`
        : `Внимание в ${finalPlace}: ${numericPrice.toFixed(2)} лв.!`);
    const numericRef = referencePrice.trim()
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
    const numericUnitQty = Number(unitQuantity.replace(',', '.'));
    const computedPricePerKg =
      !isNaN(numericUnitQty) && numericUnitQty > 0
        ? Number(((numericPrice / numericUnitQty) * 1000).toFixed(2))
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
          description.trim() ||
          (isGreen
            ? 'Страхотно съотношение цена-качество, препоръчвам!'
            : 'Не препоръчвам — цената не отговаря на качеството.'),
        placeName: finalPlace,
        city,
        address: finalAddress,
        latitude,
        longitude,
        googleMapsUrl: mapsUrl,
        locationAutoDetected: Boolean(locationDetectedLabel),
        pricePaid: numericPrice,
        referencePrice: numericRef && !isNaN(numericRef) ? numericRef : undefined,
        unitQuantity: !isNaN(numericUnitQty) && numericUnitQty > 0 ? numericUnitQty : undefined,
        unitType: !isNaN(numericUnitQty) && numericUnitQty > 0 ? unitType : undefined,
        isShrinkflation,
        isFakePromo,
        imageUri: imageUri || SAMPLE_PHOTOS[category],
        comparisonImageUri: comparisonImageUri.trim() || undefined,
        receipt: scannedReceipt,
        tags: [
          '#СнимкаСЦена',
          isGreen ? '#ТопНаходка' : '#ЧервенФлаг',
          `#${city}`,
          `#${finalPlatform.replace(/\s+/g, '')}`,
          ...(finalCustomCategory
            ? [`#${finalCustomCategory.replace(/\s+/g, '')}`]
            : []),
          ...(isShrinkflation ? ['#Шринкфлация'] : []),
          ...(isFakePromo ? ['#ФалшиваПромоция'] : []),
        ],
      });

      // Нулиране на формата и пренасочване към потока
      setTitle('');
      setDescription('');
      setPlaceName('');
      setAddress('');
      setCustomCategoryLabel('');
      setCustomPlatformLabel('');
      setLatitude(undefined);
      setLongitude(undefined);
      setLocationDetectedLabel('');
      setPricePaid('');
      setReferencePrice('');
      setUnitQuantity('');
      setIsShrinkflation(false);
      setIsFakePromo(false);
      setComparisonImageUri('');
      setHasUserPhoto(false);
      setScannedReceipt(undefined);
      router.replace('/(tabs)');
    } finally {
      setIsSubmitting(false);
    }
  };

  const parsedPrice = Number(pricePaid.replace(',', '.'));
  const parsedRef = Number(referencePrice.replace(',', '.'));
  const parsedUnitQty = Number(unitQuantity.replace(',', '.'));
  // Цена за единица: г/мл се нормират към 1 кг/1 л, бр. си остава за брой.
  const livePricePerUnit =
    !isNaN(parsedPrice) &&
    parsedPrice > 0 &&
    !isNaN(parsedUnitQty) &&
    parsedUnitQty > 0
      ? unitType === 'g' || unitType === 'ml'
        ? Number(((parsedPrice / parsedUnitQty) * 1000).toFixed(2))
        : Number((parsedPrice / parsedUnitQty).toFixed(2))
      : null;
  const unitShortLabel =
    unitType === 'g' || unitType === 'kg' ? 'кг' : unitType === 'pcs' ? 'бр.' : 'л';
  const liveDiffPercent =
    !isNaN(parsedPrice) &&
    parsedPrice > 0 &&
    !isNaN(parsedRef) &&
    parsedRef > 0
      ? Math.round((Math.abs(parsedRef - parsedPrice) / parsedRef) * 100)
      : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.screenTitle}>Качи Снимка с Цена 📸</Text>
        <Text style={styles.screenSub}>
          Снимай етикет, меню, продукт или касова бележка и сподели реалната цена
        </Text>

        {/* Избор на Полярност: 🟢 Оферта vs 🔴 Червен Флаг */}
        <View style={styles.polaritySelector}>
          <TouchableOpacity
            style={[
              styles.polarityBox,
              isGreen && styles.polarityBoxGreenActive,
            ]}
            onPress={() => setPolarity('green')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={isGreen ? COLORS.greenBright : COLORS.textMuted}
            />
            <Text
              style={[
                styles.polarityBoxTitle,
                isGreen && { color: COLORS.greenBright },
              ]}
              numberOfLines={1}
            >
              🟢 Топ Находка
            </Text>
            <Text style={styles.polarityBoxSub} numberOfLines={2}>
              Евтина цена, честна оферта, струва си
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.polarityBox,
              !isGreen && styles.polarityBoxRedActive,
            ]}
            onPress={() => setPolarity('red')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="warning"
              size={20}
              color={!isGreen ? COLORS.redBright : COLORS.textMuted}
            />
            <Text
              style={[
                styles.polarityBoxTitle,
                !isGreen && { color: COLORS.redBright },
              ]}
              numberOfLines={1}
            >
              🔴 Червен Флаг
            </Text>
            <Text style={styles.polarityBoxSub} numberOfLines={2}>
              Скрити такси, скъп капан, измама
            </Text>
          </TouchableOpacity>
        </View>

        {/* СТЪПКА 1: СНИМКА С ЦЕНА (Камера / Галерия + Превю на етикета) */}
        <View style={styles.photoUploadCard}>
          <View style={styles.photoCardHeader}>
            <Text style={styles.photoCardTitle}>
              1. Снимка на продукта / менюто / цената
            </Text>
            {hasUserPhoto && (
              <View style={styles.userPhotoTag}>
                <Text style={styles.userPhotoTagText}>✓ Качена снимка</Text>
              </View>
            )}
          </View>

          <View style={styles.photoPreviewBox}>
            <Image source={{ uri: imageUri }} style={styles.previewImg} />

            {/* Жив ценови бадж върху снимката */}
            <View style={styles.livePriceOverlay}>
              <View style={{ flex: 1 }}>
                <Text style={styles.livePriceSmallLabel}>
                  {isGreen ? 'ПЛАТЕНА ТОП ЦЕНА' : 'ПЛАТЕНА СУМА (КАПАН)'}
                </Text>
                <View style={styles.livePriceNumbers}>
                  <Text style={[styles.livePriceMain, { color: accentColor }]}>
                    {!isNaN(parsedPrice) && parsedPrice > 0
                      ? `${parsedPrice.toFixed(2)} лв.`
                      : 'Въведи цена долу'}
                  </Text>
                  {!isNaN(parsedRef) && parsedRef > 0 && (
                    <Text style={styles.livePriceRef}>
                      {isGreen ? 'вместо ' : 'реална: '}
                      {parsedRef.toFixed(2)} лв.
                    </Text>
                  )}
                </View>
              </View>

              {liveDiffPercent !== null && (
                <View
                  style={[
                    styles.liveDiffPill,
                    { backgroundColor: accentColor },
                  ]}
                >
                  <Text style={styles.liveDiffPillText}>
                    {isGreen ? `-${liveDiffPercent}%` : `+${liveDiffPercent}%`}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Големи бутони за снимане или галерия */}
          <View style={styles.mainPhotoBtnsRow}>
            <TouchableOpacity
              style={[styles.mainPhotoBtnPrimary, { backgroundColor: accentColor }]}
              onPress={() => pickMainImage(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="camera" size={18} color={COLORS.white} />
              <Text style={styles.mainPhotoBtnPrimaryText}>Снимай с Камера</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mainPhotoBtnSecondary}
              onPress={() => pickMainImage(false)}
              activeOpacity={0.85}
            >
              <Ionicons name="images" size={18} color={COLORS.textPrimary} />
              <Text style={styles.mainPhotoBtnSecondaryText}>От Галерия</Text>
            </TouchableOpacity>
          </View>

          {/* Опционална втора снимка: Обява/Меню vs Реалност */}
          <View style={styles.secondPhotoSection}>
            <View style={styles.secondPhotoRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.secondPhotoTitle}>
                  + Втора снимка за сравнение (по избор)
                </Text>
                <Text style={styles.secondPhotoSub}>
                  Напр. снимка на етикета/менюто + реалния продукт
                </Text>
              </View>
              <View style={styles.secondPhotoBtns}>
                <TouchableOpacity
                  style={styles.miniPickBtn}
                  onPress={() => pickComparisonImage(true)}
                >
                  <Ionicons name="camera-outline" size={16} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.miniPickBtn}
                  onPress={() => pickComparisonImage(false)}
                >
                  <Ionicons name="images-outline" size={16} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            {comparisonImageUri ? (
              <View style={styles.comparisonThumbRow}>
                <Image
                  source={{ uri: comparisonImageUri }}
                  style={styles.comparisonThumb}
                />
                <Text style={styles.comparisonAddedText}>
                  Втора сравнителна снимка е прикачена
                </Text>
                <TouchableOpacity onPress={() => setComparisonImageUri('')}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.redBright} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {/* СТЪПКА 2: ЦЕНИ */}
        <View style={styles.priceInputsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>2. Цена от снимката (лв.) *</Text>
            <TextInput
              style={[
                styles.input,
                styles.priceInputHighlight,
                { borderColor: accentColor },
              ]}
              placeholder="напр. 14.90"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
              value={pricePaid}
              onChangeText={setPricePaid}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>
              {isGreen ? 'Стара/обичайна (лв.):' : 'Реална стойност (лв.):'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="напр. 28.00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
              value={referencePrice}
              onChangeText={setReferencePrice}
            />
          </View>
        </View>

        {/* Грамаж/Обем (за автоматична цена на 1 кг / 1 л) + Шринкфлация & Фалшива Промоция */}
        <View
          style={{
            backgroundColor: COLORS.bgCard,
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
            borderRadius: 14,
            padding: 10,
            marginTop: 8,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 11, fontWeight: '700' }}>
                ⚖️ Грамаж / обем / брой (по избор):
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                {(
                  [
                    { id: 'g', label: 'грама' },
                    { id: 'kg', label: 'кг' },
                    { id: 'ml', label: 'мл' },
                    { id: 'l', label: 'литри' },
                    { id: 'pcs', label: 'брой' },
                  ] as const
                ).map((option) => {
                  const active = unitType === option.id;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      onPress={() => setUnitType(option.id)}
                      style={{
                        backgroundColor: active ? COLORS.accentIndigo : COLORS.bgCardElevated,
                        borderWidth: 1,
                        borderColor: active ? COLORS.accentIndigo : COLORS.borderSubtle,
                        borderRadius: 9,
                        paddingHorizontal: 9,
                        paddingVertical: 5,
                      }}
                    >
                      <Text
                        style={{
                          color: active ? COLORS.white : COLORS.textSecondary,
                          fontSize: 11,
                          fontWeight: active ? '800' : '600',
                        }}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                style={[styles.input, { marginTop: 5, paddingVertical: 8 }]}
                placeholder={
                  unitType === 'pcs'
                    ? 'напр. 10 (за цена за брой)'
                    : `напр. 400 (за автоматична цена за 1 ${unitShortLabel})`
                }
                placeholderTextColor={COLORS.textMuted}
                keyboardType="decimal-pad"
                value={unitQuantity}
                onChangeText={setUnitQuantity}
              />
            </View>
            {livePricePerUnit !== null && (
              <View
                style={{
                  backgroundColor: 'rgba(6, 182, 212, 0.14)',
                  borderWidth: 1,
                  borderColor: 'rgba(6, 182, 212, 0.45)',
                  borderRadius: 11,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: COLORS.textMuted, fontSize: 9.5, fontWeight: '800' }}>
                  ЦЕНА ЗА 1 {unitShortLabel.toUpperCase()}
                </Text>
                <Text style={{ color: COLORS.accentCyan, fontSize: 14, fontWeight: '900' }}>
                  {livePricePerUnit.toFixed(2)} лв.
                </Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: isShrinkflation
                  ? COLORS.redSoftBg
                  : COLORS.bgCardElevated,
                borderWidth: 1,
                borderColor: isShrinkflation
                  ? COLORS.redPrimary
                  : COLORS.borderStrong,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
              }}
              onPress={() => setIsShrinkflation((prev) => !prev)}
            >
              <Ionicons
                name="trending-down"
                size={13}
                color={isShrinkflation ? COLORS.redBright : COLORS.textMuted}
              />
              <Text
                style={{
                  color: isShrinkflation ? COLORS.redBright : COLORS.textSecondary,
                  fontSize: 11,
                  fontWeight: '800',
                }}
              >
                📉 Шринкфлация (намален грамаж)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: isFakePromo
                  ? COLORS.goldSoftBg
                  : COLORS.bgCardElevated,
                borderWidth: 1,
                borderColor: isFakePromo
                  ? COLORS.goldBright
                  : COLORS.borderStrong,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
              }}
              onPress={() => setIsFakePromo((prev) => !prev)}
            >
              <Ionicons
                name="alert-circle"
                size={13}
                color={isFakePromo ? COLORS.goldBright : COLORS.textMuted}
              />
              <Text
                style={{
                  color: isFakePromo ? COLORS.goldBright : COLORS.textSecondary,
                  fontSize: 11,
                  fontWeight: '800',
                }}
              >
                ⚠️ Фалшива промоция
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {liveDiffPercent !== null && (
          <View
            style={{
              backgroundColor: isGreen ? COLORS.greenSoftBg : COLORS.redSoftBg,
              borderColor: isGreen ? COLORS.greenBorder : COLORS.redBorder,
              borderWidth: 1,
              borderRadius: 12,
              padding: 9,
              marginTop: 4,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <Ionicons
              name="sparkles"
              size={15}
              color={isGreen ? COLORS.greenBright : COLORS.redBright}
            />
            <Text
              style={{
                flex: 1,
                color: isGreen ? COLORS.greenBright : COLORS.redBright,
                fontSize: 11.5,
                fontWeight: '700',
              }}
            >
              {isGreen
                ? `Умна оценка: Спестяване от ${Math.abs(parsedRef - parsedPrice).toFixed(2)} лв. (-${liveDiffPercent}% спрямо нормалната цена)!`
                : `Умна оценка: Надценка от +${Math.abs(parsedPrice - parsedRef).toFixed(2)} лв. (+${liveDiffPercent}% над реалната стойност)!`}
            </Text>
          </View>
        )}

        {/* AI Скенер на касова бележка (Най-бързият начин!) */}
        <View style={styles.aiScannerCard}>
          <View style={styles.aiScannerHeader}>
            <View style={styles.aiIconBadge}>
              <Ionicons name="scan" size={19} color={COLORS.goldBright} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.aiScannerTitle} numberOfLines={1}>
                🧾 Имаш и касова бележка? (3x Точки!)
              </Text>
              <Text style={styles.aiScannerSub}>
                AI скенерът извлича обекта, цените и слага значка „Доказано с бележка“
              </Text>
            </View>
          </View>

          <View style={styles.aiButtonsRow}>
            <TouchableOpacity
              style={styles.aiScanPrimaryBtn}
              onPress={() => handleScanReceipt('demo')}
              disabled={isScanningReceipt}
            >
              {isScanningReceipt ? (
                <ActivityIndicator color={COLORS.black} size="small" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={15} color={COLORS.black} />
                  <Text style={styles.aiScanPrimaryBtnText} numberOfLines={1}>
                    Авто-попълване от бележка
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.aiScanSecondaryBtn}
              onPress={() => handleScanReceipt('camera')}
              disabled={isScanningReceipt}
            >
              <Ionicons name="camera-outline" size={18} color={COLORS.goldBright} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.aiScanSecondaryBtn}
              onPress={() => handleScanReceipt('gallery')}
              disabled={isScanningReceipt}
            >
              <Ionicons name="images-outline" size={18} color={COLORS.goldBright} />
            </TouchableOpacity>
          </View>

          {scannedReceipt && (
            <ReceiptModalCard receipt={scannedReceipt} polarity={polarity} />
          )}
        </View>

        {/* СТЪПКА 3: АВТОМАТИЧНА ЛОКАЦИЯ НА МАГАЗИНА & GOOGLE MAPS */}
        <Text style={styles.label}>
          3. Магазин / Заведение и локация в Google Maps *
        </Text>
        <View
          style={{
            backgroundColor: COLORS.bgCard,
            borderWidth: 1,
            borderColor: locationDetectedLabel
              ? COLORS.greenBorder
              : COLORS.borderStrong,
            borderRadius: 16,
            padding: 12,
            gap: 9,
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
                size={19}
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
                  ? '🛰️ Засичане на магазин и адрес от GPS / снимка...'
                  : locationDetectedLabel ||
                    '📍 Автоматично засичане при качване на снимка или с бутона:'}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => triggerAutoLocation()}
              disabled={isDetectingLocation}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: COLORS.greenSoftBg,
                borderWidth: 1,
                borderColor: COLORS.greenBorder,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
              }}
            >
              {isDetectingLocation ? (
                <ActivityIndicator size="small" color={COLORS.greenBright} />
              ) : (
                <>
                  <Ionicons name="locate" size={14} color={COLORS.greenBright} />
                  <Text
                    style={{
                      color: COLORS.greenBright,
                      fontSize: 11.5,
                      fontWeight: '800',
                    }}
                  >
                    Засечи GPS
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
                Засечени обекти наблизо (избери с 1 клик):
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
                        paddingHorizontal: 10,
                        paddingVertical: 6,
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

          <TextInput
            style={styles.input}
            placeholder="Име на магазин / ресторант / хотел (напр. Kaufland / Lidl)..."
            placeholderTextColor={COLORS.textMuted}
            value={placeName}
            onChangeText={setPlaceName}
          />

          <TextInput
            style={styles.input}
            placeholder="Точен адрес за Google Maps (напр. бул. Витоша 89)..."
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
              backgroundColor: 'rgba(59, 130, 246, 0.14)',
              borderWidth: 1,
              borderColor: 'rgba(59, 130, 246, 0.42)',
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Ionicons name="map" size={16} color="#60A5FA" />
            <Text
              style={{
                color: '#60A5FA',
                fontSize: 12.5,
                fontWeight: '800',
              }}
            >
              Виж адреса в Google Maps
            </Text>
            <Ionicons name="open-outline" size={14} color="#60A5FA" />
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>4. Какво снима (продукт / заглавие) *</Text>
        <TextInput
          style={styles.input}
          placeholder={
            isGreen
              ? 'напр. Прясна риба + салата само за 14.90 лв.!'
              : 'напр. 9.80 лв. за малка вода и 15% скрита такса!'
          }
          placeholderTextColor={COLORS.textMuted}
          value={title}
          onChangeText={setTitle}
        />

        {/* Избор на Категория (Гъвкава мрежа + Потребителско описание при "Други") */}
        <Text style={styles.label}>5. Категория:</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORIES.filter((c) => c.id !== 'all').map((cat) => {
            const selected = category === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.pillBtn,
                  selected && {
                    backgroundColor: accentColor,
                    borderColor: accentColor,
                  },
                ]}
                onPress={() => {
                  const nextCat = cat.id as Exclude<CategoryId, 'all'>;
                  setCategory(nextCat);
                  if (!hasUserPhoto) {
                    setImageUri(SAMPLE_PHOTOS[nextCat]);
                  }
                }}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={15}
                  color={selected ? COLORS.white : COLORS.textSecondary}
                />
                <Text
                  style={[
                    styles.pillBtnText,
                    selected && { color: COLORS.white, fontWeight: '800' },
                  ]}
                >
                  {cat.shortLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {category === 'other' && (
          <View
            style={{
              backgroundColor: COLORS.bgCard,
              borderWidth: 1,
              borderColor: accentColor,
              borderRadius: 14,
              padding: 11,
              marginTop: 8,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="create-outline" size={16} color={accentColor} />
              <Text
                style={{
                  color: COLORS.textPrimary,
                  fontSize: 12.5,
                  fontWeight: '800',
                  flex: 1,
                }}
              >
                Опиши каква е категорията / сферата („Други“):
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_CUSTOM_CATEGORIES.map((item) => {
                const active = customCategoryLabel === item;
                return (
                  <TouchableOpacity
                    key={item}
                    onPress={() => setCustomCategoryLabel(item)}
                    style={{
                      backgroundColor: active ? accentColor : COLORS.bgCardElevated,
                      borderWidth: 1,
                      borderColor: active ? accentColor : COLORS.borderSubtle,
                      borderRadius: 8,
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? COLORS.white : COLORS.textSecondary,
                        fontSize: 11,
                        fontWeight: active ? '800' : '600',
                      }}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Напиши твоя категория (напр. Аптека, Бензиностанция, Автосервиз...)"
              placeholderTextColor={COLORS.textMuted}
              value={customCategoryLabel}
              onChangeText={setCustomCategoryLabel}
            />
          </View>
        )}

        {/* Избор на Платформа (Гъвкава мрежа + Потребителско описание при "Други") */}
        <Text style={styles.label}>6. Платформа / Начин на покупка:</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PLATFORM_TAGS.map((tag) => {
            const selected = platformTag === tag;
            return (
              <TouchableOpacity
                key={tag}
                style={[
                  styles.pillBtn,
                  selected && {
                    backgroundColor: COLORS.accentIndigo,
                    borderColor: COLORS.accentIndigo,
                  },
                ]}
                onPress={() => setPlatformTag(tag)}
              >
                {tag === 'Други' && (
                  <Ionicons
                    name="add-circle-outline"
                    size={15}
                    color={selected ? COLORS.white : COLORS.textSecondary}
                  />
                )}
                <Text
                  style={[
                    styles.pillBtnText,
                    selected && { color: COLORS.white, fontWeight: '800' },
                  ]}
                >
                  {tag}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {platformTag === 'Други' && (
          <View
            style={{
              backgroundColor: COLORS.bgCard,
              borderWidth: 1,
              borderColor: COLORS.accentIndigo,
              borderRadius: 14,
              padding: 11,
              marginTop: 8,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={COLORS.accentIndigo}
              />
              <Text
                style={{
                  color: COLORS.textPrimary,
                  fontSize: 12.5,
                  fontWeight: '800',
                  flex: 1,
                }}
              >
                Опиши платформата или начина на покупка („Други“):
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_CUSTOM_PLATFORMS.map((item) => {
                const active = customPlatformLabel === item;
                return (
                  <TouchableOpacity
                    key={item}
                    onPress={() => setCustomPlatformLabel(item)}
                    style={{
                      backgroundColor: active
                        ? COLORS.accentIndigo
                        : COLORS.bgCardElevated,
                      borderWidth: 1,
                      borderColor: active
                        ? COLORS.accentIndigo
                        : COLORS.borderSubtle,
                      borderRadius: 8,
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? COLORS.white : COLORS.textSecondary,
                        fontSize: 11,
                        fontWeight: active ? '800' : '600',
                      }}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Напиши откъде е (напр. Glovo, Takeaway, OLX, Instagram, Пазар...)"
              placeholderTextColor={COLORS.textMuted}
              value={customPlatformLabel}
              onChangeText={setCustomPlatformLabel}
            />
          </View>
        )}

        {/* Град (Падащо меню с всички градове в България) */}
        <Text style={styles.label}>7. Град / Населено място в България:</Text>
        <CityPickerDropdown
          selectedCity={city}
          onSelectCity={setCity}
          includeAllOption={false}
          label="Избран град за публикацията"
          accentColor={accentColor}
        />

        {/* Подробно мнение */}
        <Text style={styles.label}>8. Допълнителни детайли (по избор):</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Сподели подробности за качеството, грамажа или обслужването..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          numberOfLines={3}
          value={description}
          onChangeText={setDescription}
        />

        {/* Бутон за публикуване */}
        <TouchableOpacity
          style={[styles.publishButton, { backgroundColor: accentColor }]}
          onPress={handlePublish}
          disabled={isSubmitting}
          activeOpacity={0.88}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons
                name={isGreen ? 'rocket' : 'megaphone'}
                size={19}
                color={COLORS.white}
              />
              <Text
                style={styles.publishButtonText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {isGreen
                  ? 'Публикувай Снимката с Топ Цена'
                  : 'Публикувай Червен Флаг с Цена'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 115,
  },
  screenTitle: {
    color: COLORS.textPrimary,
    fontSize: 21,
    fontWeight: '900',
  },
  screenSub: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 3,
    marginBottom: 12,
  },
  polaritySelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  polarityBox: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1.5,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 11,
  },
  polarityBoxGreenActive: {
    backgroundColor: COLORS.greenSoftBg,
    borderColor: COLORS.greenPrimary,
  },
  polarityBoxRedActive: {
    backgroundColor: COLORS.redSoftBg,
    borderColor: COLORS.redPrimary,
  },
  polarityBoxTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 5,
    marginBottom: 2,
  },
  polarityBoxSub: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  photoUploadCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 12,
    marginBottom: 12,
  },
  photoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 6,
  },
  photoCardTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  userPhotoTag: {
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
  },
  userPhotoTagText: {
    color: COLORS.greenBright,
    fontSize: 10,
    fontWeight: '800',
  },
  photoPreviewBox: {
    height: 190,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.bgSecondary,
    marginBottom: 10,
    position: 'relative',
  },
  previewImg: {
    width: '100%',
    height: '100%',
  },
  livePriceOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(9, 13, 22, 0.9)',
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  livePriceSmallLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
  },
  livePriceNumbers: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 1,
  },
  livePriceMain: {
    fontSize: 16,
    fontWeight: '900',
  },
  livePriceRef: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    textDecorationLine: 'line-through',
  },
  liveDiffPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveDiffPillText: {
    color: COLORS.white,
    fontSize: 10.5,
    fontWeight: '900',
  },
  mainPhotoBtnsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  mainPhotoBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  mainPhotoBtnPrimaryText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
  mainPhotoBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingVertical: 11,
    borderRadius: 12,
  },
  mainPhotoBtnSecondaryText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  secondPhotoSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
  },
  secondPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  secondPhotoTitle: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  secondPhotoSub: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    marginTop: 1,
  },
  secondPhotoBtns: {
    flexDirection: 'row',
    gap: 6,
  },
  miniPickBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comparisonThumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    backgroundColor: COLORS.bgSecondary,
    padding: 7,
    borderRadius: 10,
  },
  comparisonThumb: {
    width: 42,
    height: 42,
    borderRadius: 8,
  },
  comparisonAddedText: {
    flex: 1,
    color: COLORS.greenBright,
    fontSize: 11.5,
    fontWeight: '700',
  },
  aiScannerCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1.5,
    borderColor: COLORS.goldBorder,
    borderRadius: 18,
    padding: 12,
    marginTop: 10,
    marginBottom: 10,
  },
  aiScannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 10,
  },
  aiIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.goldSoftBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  aiScannerTitle: {
    color: COLORS.goldBright,
    fontSize: 13,
    fontWeight: '800',
  },
  aiScannerSub: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  aiButtonsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  aiScanPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.goldBright,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 11,
  },
  aiScanPrimaryBtnText: {
    color: COLORS.black,
    fontSize: 12,
    fontWeight: '900',
  },
  aiScanSecondaryBtn: {
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 11,
  },
  label: {
    color: COLORS.textPrimary,
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 8,
  },
  horizontalPills: {
    gap: 7,
    paddingBottom: 4,
  },
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 11,
  },
  pillBtnText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: COLORS.textPrimary,
    fontSize: 13.5,
    marginBottom: 4,
  },
  priceInputHighlight: {
    borderWidth: 1.5,
    fontWeight: '800',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  priceInputsRow: {
    flexDirection: 'row',
    gap: 9,
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 12,
    borderRadius: 15,
    marginTop: 14,
  },
  publishButtonText: {
    color: COLORS.white,
    fontSize: 14.5,
    fontWeight: '900',
  },
});
