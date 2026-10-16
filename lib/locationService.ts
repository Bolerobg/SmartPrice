import { Linking, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { CITIES } from '@/constants/theme';

export interface DetectedLocationInfo {
  latitude: number;
  longitude: number;
  city: string;
  address: string;
  detectedPlaceName?: string;
  nearbyPlaces: string[];
  googleMapsUrl: string;
  source: 'photo_exif' | 'device_gps' | 'ip_fallback' | 'unavailable';
  /** true = координатите идват от устройството/EXIF, не от приблизителен център на град */
  hasRealCoordinates: boolean;
}

interface CityPresetLocation {
  city: string;
  latitude: number;
  longitude: number;
  defaultAddress: string;
  stores: string[];
}

const CITY_PRESET_LOCATIONS: Record<string, CityPresetLocation> = {
  София: {
    city: 'София',
    latitude: 42.6977,
    longitude: 23.3219,
    defaultAddress: 'бул. „Витоша“ 89, Център',
    stores: [
      'Kaufland София Център',
      'Lidl бул. Витоша',
      'Billa НДК',
      'Фантастико F6',
      'Ресторант Щастливеца',
    ],
  },
  Пловдив: {
    city: 'Пловдив',
    latitude: 42.1449,
    longitude: 24.7453,
    defaultAddress: 'ул. „Княз Александър I“ 32, Капана',
    stores: [
      'Kaufland Пловдив Тракия',
      'Lidl Кършияка',
      'Billa Главната',
      'Бистро Капана Крафт',
      'Ресторант Хемингуей',
    ],
  },
  Варна: {
    city: 'Варна',
    latitude: 43.2047,
    longitude: 27.9147,
    defaultAddress: 'бул. „Княз Борис I“ 65, Морска градина',
    stores: [
      'Ресторант Стария Чинар (Порт Варна)',
      'Kaufland Варна Бриз',
      'Lidl Варна Център',
      'Billa Севастопол',
      'Супермаркет Макао',
    ],
  },
  Бургас: {
    city: 'Бургас',
    latitude: 42.4975,
    longitude: 27.4726,
    defaultAddress: 'ул. „Александровска“ 48, Център',
    stores: [
      'Kaufland Бургас Славейков',
      'Lidl Бургас Лазур',
      'Billa Александровска',
      'Ресторант Роза',
      'Болеро Супермаркет',
    ],
  },
  Русе: {
    city: 'Русе',
    latitude: 43.8486,
    longitude: 25.9539,
    defaultAddress: 'ул. „Александровска“ 52, Център',
    stores: [
      'Kaufland Русе',
      'Lidl Русе Център',
      'Супермаркет Пацони',
      'Ресторант Чифлика',
    ],
  },
  'Стара Загора': {
    city: 'Стара Загора',
    latitude: 42.4258,
    longitude: 25.6345,
    defaultAddress: 'бул. „Цар Симеон Велики“ 105',
    stores: [
      'Kaufland Стара Загора',
      'Lidl Стара Загора',
      'Billa Парк Мол',
      'Ресторант Форум',
    ],
  },
  Банско: {
    city: 'Банско',
    latitude: 41.8291,
    longitude: 23.4785,
    defaultAddress: 'ул. „Пирин“ 92, До начална станция на лифта',
    stores: [
      'Механа Дедо Пене',
      'Lidl Разлог / Банско',
      'Супермаркет Алдо Банско',
      'СПА Хотел Пирин Резидънс',
    ],
  },
  Созопол: {
    city: 'Созопол',
    latitude: 42.4173,
    longitude: 27.6961,
    defaultAddress: 'Крайбрежна алея 14, Стария град',
    stores: [
      'Ресторант Морски Бриз VIP',
      'Бистро Стария Созопол',
      'Супермаркет Болеро Созопол',
    ],
  },
};

function parseExifCoord(value: any, ref?: string): number | null {
  if (typeof value === 'number' && !isNaN(value)) {
    const sign = ref === 'S' || ref === 'W' ? -1 : 1;
    return Math.abs(value) * sign;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      const sign = ref === 'S' || ref === 'W' ? -1 : 1;
      return Math.abs(parsed) * sign;
    }
  }
  if (Array.isArray(value) && value.length >= 2) {
    const deg = Number(value[0]) || 0;
    const min = Number(value[1]) || 0;
    const sec = Number(value[2]) || 0;
    const decimal = deg + min / 60 + sec / 3600;
    if (!isNaN(decimal) && decimal > 0) {
      const sign = ref === 'S' || ref === 'W' ? -1 : 1;
      return decimal * sign;
    }
  }
  return null;
}

/**
 * Извлича GPS координати от EXIF метаданните на снимката (ако са налични)
 */
export function extractGpsFromExif(
  exif?: Record<string, any> | null
): { latitude: number; longitude: number } | null {
  if (!exif) return null;

  const lat = parseExifCoord(
    exif.GPSLatitude ?? exif.latitude,
    exif.GPSLatitudeRef
  );
  const lon = parseExifCoord(
    exif.GPSLongitude ?? exif.longitude,
    exif.GPSLongitudeRef
  );

  if (
    lat !== null &&
    lon !== null &&
    Math.abs(lat) > 0.01 &&
    Math.abs(lon) > 0.01
  ) {
    return { latitude: lat, longitude: lon };
  }
  return null;
}

/**
 * Намира най-близкия или съвпадащ български град от списъка CITIES
 */
export function matchBulgarianCity(
  rawCity?: string | null,
  lat?: number,
  lon?: number
): string {
  if (rawCity) {
    const clean = rawCity
      .replace(/^(гр\.|град|община|област)\s+/i, '')
      .trim()
      .toLowerCase();

    const exact = CITIES.find(
      (c) => c !== 'Всички градове' && c.toLowerCase() === clean
    );
    if (exact) return exact;

    const partial = CITIES.find(
      (c) =>
        c !== 'Всички градове' &&
        (clean.includes(c.toLowerCase()) || c.toLowerCase().includes(clean))
    );
    if (partial) return partial;
  }

  // Ако имаме координати, проверяваме най-близкия голям град
  if (typeof lat === 'number' && typeof lon === 'number') {
    let bestCity = 'София';
    let minDistance = Infinity;
    for (const preset of Object.values(CITY_PRESET_LOCATIONS)) {
      const d =
        Math.pow(preset.latitude - lat, 2) +
        Math.pow(preset.longitude - lon, 2);
      if (d < minDistance) {
        minDistance = d;
        bestCity = preset.city;
      }
    }
    return bestCity;
  }

  return 'София';
}

/**
 * Генерира директен линк към Google Maps за адрес, магазин и GPS координати
 */
export function buildGoogleMapsUrl(params: {
  placeName?: string;
  address?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}): string {
  const parts = [
    params.placeName?.trim(),
    params.address?.trim(),
    params.city && params.city !== 'Всички градове' ? params.city.trim() : '',
    'България',
  ].filter(Boolean);

  if (parts.length > 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      parts.join(', ')
    )}`;
  }

  if (
    typeof params.latitude === 'number' &&
    typeof params.longitude === 'number'
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${params.latitude},${params.longitude}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    parts.join(', ') || 'България'
  )}`;
}

/**
 * Отваря Google Maps с магазина и точния му адрес / координати
 */
export async function openInGoogleMaps(params: {
  placeName?: string;
  address?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
}): Promise<void> {
  const queryParts = [
    params.placeName?.trim(),
    params.address?.trim(),
    params.city && params.city !== 'Всички градове' ? params.city.trim() : '',
  ].filter(Boolean);

  const queryString = queryParts.join(', ');
  const fallbackWebUrl =
    params.googleMapsUrl ||
    buildGoogleMapsUrl({
      placeName: params.placeName,
      address: params.address,
      city: params.city,
      latitude: params.latitude,
      longitude: params.longitude,
    });

  try {
    if (Platform.OS === 'ios') {
      const iosGoogleMapsScheme = queryString
        ? `comgooglemaps://?q=${encodeURIComponent(queryString)}${
            params.latitude && params.longitude
              ? `&center=${params.latitude},${params.longitude}`
              : ''
          }`
        : params.latitude && params.longitude
        ? `comgooglemaps://?q=${params.latitude},${params.longitude}`
        : null;

      if (iosGoogleMapsScheme) {
        const canOpen = await Linking.canOpenURL(iosGoogleMapsScheme);
        if (canOpen) {
          await Linking.openURL(iosGoogleMapsScheme);
          return;
        }
      }
    }

    await Linking.openURL(fallbackWebUrl);
  } catch {
    try {
      await Linking.openURL(fallbackWebUrl);
    } catch {
      // Игнориране
    }
  }
}

/**
 * Засича GPS координати от устройството чрез вградения ExpoLocation модул или браузър/IP
 */
async function getDeviceCoordinates(): Promise<{
  latitude: number;
  longitude: number;
  source: 'device_gps' | 'ip_fallback';
} | null> {
  // 1. Опит през нативния модул ExpoLocation (вграден в Expo Go за iOS и Android)
  try {
    const ExpoLocation = requireOptionalNativeModule<any>('ExpoLocation');
    if (ExpoLocation) {
      const perm = await ExpoLocation.requestForegroundPermissionsAsync?.();
      if (perm?.granted || perm?.status === 'granted') {
        const pos = await ExpoLocation.getCurrentPositionAsync?.({
          accuracy: 4,
        });
        if (
          pos?.coords &&
          typeof pos.coords.latitude === 'number' &&
          typeof pos.coords.longitude === 'number'
        ) {
          return {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            source: 'device_gps',
          };
        }
      }
    }
  } catch {
    // Продължаваме към следващия метод
  }

  // 2. Опит през стандартния navigator.geolocation
  try {
    const navGeo = (globalThis as any)?.navigator?.geolocation;
    if (navGeo && typeof navGeo.getCurrentPosition === 'function') {
      const coords = await new Promise<{ latitude: number; longitude: number } | null>(
        (resolve) => {
          const timeoutId = setTimeout(() => resolve(null), 4000);
          navGeo.getCurrentPosition(
            (pos: any) => {
              clearTimeout(timeoutId);
              if (pos?.coords) {
                resolve({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                });
              } else {
                resolve(null);
              }
            },
            () => {
              clearTimeout(timeoutId);
              resolve(null);
            },
            { enableHighAccuracy: true, timeout: 3500, maximumAge: 30000 }
          );
        }
      );
      if (coords) {
        return { ...coords, source: 'device_gps' };
      }
    }
  } catch {
    // Продължаваме към IP геолокация
  }

  // 3. Опит за геолокация по мрежа/IP (работи винаги без нужда от GPS права)
  try {
    const res = await fetch('https://ipwho.is/');
    if (res.ok) {
      const data = await res.json();
      if (
        typeof data?.latitude === 'number' &&
        typeof data?.longitude === 'number'
      ) {
        return {
          latitude: data.latitude,
          longitude: data.longitude,
          source: 'ip_fallback',
        };
      }
    }
  } catch {
    // Игнориране
  }

  return null;
}

/**
 * Автоматично засича локацията (от EXIF на снимката или GPS на телефона),
 * намира точния адрес, град и магазин/обект наблизо, и връща Google Maps адрес.
 */
export async function detectUserAndStoreLocation(options?: {
  exif?: Record<string, any> | null;
  fallbackCity?: string;
}): Promise<DetectedLocationInfo> {
  const exifCoords = extractGpsFromExif(options?.exif);
  const deviceCoords = exifCoords ? null : await getDeviceCoordinates();

  const fallbackCity =
    options?.fallbackCity && options.fallbackCity !== 'Всички градове'
      ? options.fallbackCity
      : 'София';
  const preset =
    CITY_PRESET_LOCATIONS[fallbackCity] || CITY_PRESET_LOCATIONS['София'];

  const latitude =
    exifCoords?.latitude ?? deviceCoords?.latitude ?? preset.latitude;
  const longitude =
    exifCoords?.longitude ?? deviceCoords?.longitude ?? preset.longitude;
  const hasRealCoordinates = Boolean(exifCoords || deviceCoords);
  const source: DetectedLocationInfo['source'] = exifCoords
    ? 'photo_exif'
    : deviceCoords?.source ?? 'unavailable';

  let detectedCity = matchBulgarianCity(fallbackCity, latitude, longitude);
  let detectedAddress = '';
  let detectedPlaceName: string | undefined;
  const nearbyPlaces: string[] = [];

  // 1. Reverse Geocoding през OpenStreetMap Nominatim (на български език)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=bg&addressdetails=1&extratags=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SmartPriceBG/1.0 (https://smartprice.bg)',
      },
    });

    if (response.ok) {
      const data = await response.json();
      const addr = data?.address || {};

      const rawCity =
        addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.county;
      if (rawCity) {
        detectedCity = matchBulgarianCity(rawCity, latitude, longitude);
      }

      const street =
        addr.road ||
        addr.pedestrian ||
        addr.footway ||
        addr.suburb ||
        addr.neighbourhood ||
        addr.quarter ||
        '';
      const houseNum = addr.house_number ? ` ${addr.house_number}` : '';
      const suburb =
        addr.suburb && addr.suburb !== street ? `, кв. ${addr.suburb}` : '';

      if (street) {
        detectedAddress = `${street}${houseNum}${suburb}`;
      } else if (data?.display_name) {
        const shortParts = String(data.display_name)
          .split(',')
          .map((s) => s.trim())
          .slice(0, 3);
        detectedAddress = shortParts.join(', ');
      }

      const poiName =
        data?.name ||
        addr.shop ||
        addr.supermarket ||
        addr.amenity ||
        addr.restaurant ||
        addr.cafe ||
        addr.hotel ||
        addr.tourism ||
        addr.building;

      if (poiName && poiName !== street) {
        detectedPlaceName = String(poiName).trim();
        nearbyPlaces.push(detectedPlaceName);
      }
    }
  } catch {
    // Продължаваме с нативен reverseGeocodeAsync или локален пресет
  }

  // 2. Ако още нямаме улица, опитваме през нативния ExpoLocation.reverseGeocodeAsync
  if (!detectedAddress) {
    try {
      const ExpoLocation = requireOptionalNativeModule<any>('ExpoLocation');
      if (ExpoLocation?.reverseGeocodeAsync) {
        const list = await ExpoLocation.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        const first = list?.[0];
        if (first) {
          if (first.city || first.subregion || first.region) {
            detectedCity = matchBulgarianCity(
              first.city || first.subregion || first.region,
              latitude,
              longitude
            );
          }
          const streetPart = [first.street, first.streetNumber]
            .filter(Boolean)
            .join(' ');
          const districtPart = first.district ? `, ${first.district}` : '';
          if (streetPart) {
            detectedAddress = `${streetPart}${districtPart}`;
          }
          if (!detectedPlaceName && first.name && first.name !== first.street) {
            detectedPlaceName = first.name;
            nearbyPlaces.push(first.name);
          }
        }
      }
    } catch {
      // Игнориране
    }
  }

  // ВАЖНО: преди тук се подаваха измислени адреси и имена на магазини от
  // твърдо зададен списък (напр. „Kaufland София Център“), а UI-ът ги
  // показваше като „автоматично засечен магазин“. Сега се показва само това,
  // което реално е върнато от геокодера.

  const googleMapsUrl = buildGoogleMapsUrl({
    placeName: detectedPlaceName,
    address: detectedAddress,
    city: detectedCity,
    latitude,
    longitude,
  });

  return {
    latitude,
    longitude,
    city: detectedCity,
    address: detectedAddress,
    detectedPlaceName,
    nearbyPlaces: nearbyPlaces.slice(0, 6),
    googleMapsUrl,
    source,
    hasRealCoordinates,
  };
}

/**
 * Връща координатите за дадена публикация — САМО ако са реални.
 *
 * Промяна спрямо старата версия: преди тук се измисляше отместване по хеша на
 * ID-то около центъра на града, за да изглежда „📍 Около мен (GPS)“ реалистично.
 * Това показваше фалшиви разстояния. Сега връщаме null, ако постът няма
 * запазени координати, и UI-ът не показва разстояние.
 */
export function getCoordinatesForPost(post: {
  latitude?: number;
  longitude?: number;
  city: string;
  id?: string;
}): { latitude: number; longitude: number } | null {
  if (typeof post.latitude === 'number' && typeof post.longitude === 'number') {
    return { latitude: post.latitude, longitude: post.longitude };
  }
  return null;
}

/**
 * Изчислява разстоянието в километри между две GPS точки (Haversine формула)
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Радиус на Земята в км
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

const CITY_COORDINATES_MAP: Record<string, { latitude: number; longitude: number }> = {
  'софия': { latitude: 42.6977, longitude: 23.3219 },
  'пловдив': { latitude: 42.1354, longitude: 24.7453 },
  'варна': { latitude: 43.2141, longitude: 27.9147 },
  'бургас': { latitude: 42.5048, longitude: 27.4626 },
  'русе': { latitude: 43.8356, longitude: 25.9657 },
  'стара загора': { latitude: 42.4258, longitude: 25.6345 },
  'плевен': { latitude: 43.417, longitude: 24.6067 },
  'сливен': { latitude: 42.6817, longitude: 26.3229 },
  'добрич': { latitude: 43.5726, longitude: 27.8273 },
  'шумен': { latitude: 43.2712, longitude: 26.9361 },
  'перник': { latitude: 42.6052, longitude: 23.0378 },
  'хасково': { latitude: 41.9344, longitude: 25.5556 },
  'ямбол': { latitude: 42.4842, longitude: 26.5035 },
  'пазарджик': { latitude: 42.1887, longitude: 24.3332 },
  'благоевград': { latitude: 42.0209, longitude: 23.0943 },
  'велико търново': { latitude: 43.0757, longitude: 25.6172 },
  'враца': { latitude: 43.21, longitude: 23.5528 },
  'габрово': { latitude: 42.8742, longitude: 25.3189 },
  'асеновград': { latitude: 42.0167, longitude: 24.8667 },
  'видин': { latitude: 43.9962, longitude: 22.8679 },
  'казанлък': { latitude: 42.6194, longitude: 25.393 },
  'кюстендил': { latitude: 42.2869, longitude: 22.6939 },
  'кърджали': { latitude: 41.6338, longitude: 25.3777 },
  'монтана': { latitude: 43.4085, longitude: 23.2257 },
  'димитровград': { latitude: 42.05, longitude: 25.6 },
  'търговище': { latitude: 43.2512, longitude: 26.5722 },
  'ловеч': { latitude: 43.137, longitude: 24.7142 },
  'силистра': { latitude: 44.1147, longitude: 27.2672 },
  'разград': { latitude: 43.5333, longitude: 26.5167 },
  'смолян': { latitude: 41.5774, longitude: 24.7011 },
};

/**
 * Връща централните координати за избран български град (ако потребителят не е пуснал GPS).
 */
export function getCityCoordinates(
  cityName?: string | null
): { latitude: number; longitude: number } | null {
  if (!cityName || cityName === 'Всички градове') return null;
  const clean = cityName.trim().toLowerCase();
  if (CITY_COORDINATES_MAP[clean]) return CITY_COORDINATES_MAP[clean];
  const preset = CITY_PRESET_LOCATIONS[cityName];
  if (preset) return { latitude: preset.latitude, longitude: preset.longitude };
  return null;
}


