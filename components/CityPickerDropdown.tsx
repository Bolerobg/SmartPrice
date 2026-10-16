import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CITIES, COLORS } from '@/constants/theme';

interface CityPickerDropdownProps {
  selectedCity: string;
  onSelectCity: (city: string) => void;
  includeAllOption?: boolean;
  label?: string;
  cityPostCounts?: Record<string, number>;
  accentColor?: string;
}

const POPULAR_QUICK_CITIES = [
  'София',
  'Пловдив',
  'Варна',
  'Бургас',
  'Русе',
  'Стара Загора',
  'Велико Търново',
  'Банско',
  'Созопол',
  'Велинград',
  'Слънчев бряг',
  'Плевен',
];

export const CityPickerDropdown: React.FC<CityPickerDropdownProps> = ({
  selectedCity,
  onSelectCity,
  includeAllOption = true,
  label = 'Град / Локация',
  cityPostCounts,
  accentColor = COLORS.greenBright,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const allAvailableCities = useMemo(() => {
    const base = includeAllOption
      ? CITIES
      : CITIES.filter((c) => c !== 'Всички градове');
    // Премахване на евентуални дубликати
    return Array.from(new Set(base));
  }, [includeAllOption]);

  const filteredCities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allAvailableCities;
    return allAvailableCities.filter((city) =>
      city.toLowerCase().includes(q)
    );
  }, [allAvailableCities, searchQuery]);

  const isFilteredActive =
    includeAllOption && selectedCity !== 'Всички градове';

  const handleChoose = (city: string) => {
    onSelectCity(city);
    setSearchQuery('');
    setIsOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.dropdownTrigger,
          isFilteredActive && {
            borderColor: accentColor,
            backgroundColor: COLORS.greenSoftBg,
          },
        ]}
        onPress={() => setIsOpen(true)}
        activeOpacity={0.85}
      >
        <View style={styles.triggerLeft}>
          <View
            style={[
              styles.pinBadge,
              isFilteredActive && { backgroundColor: 'rgba(16, 185, 129, 0.25)' },
            ]}
          >
            <Ionicons
              name="location"
              size={15}
              color={isFilteredActive ? accentColor : COLORS.textSecondary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.triggerSubLabel} numberOfLines={1}>
              {label} ({allAvailableCities.length - (includeAllOption ? 1 : 0)}+ града в БГ)
            </Text>
            <Text
              style={[
                styles.triggerValue,
                isFilteredActive && { color: accentColor },
              ]}
              numberOfLines={1}
            >
              {selectedCity}
            </Text>
          </View>
        </View>

        <View style={styles.triggerRight}>
          {isFilteredActive && (
            <TouchableOpacity
              style={styles.clearCityBtn}
              onPress={(e) => {
                e.stopPropagation();
                onSelectCity('Всички градове');
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={17} color={accentColor} />
            </TouchableOpacity>
          )}
          <View style={styles.chevronBox}>
            <Ionicons
              name="chevron-down"
              size={16}
              color={isFilteredActive ? accentColor : COLORS.textSecondary}
            />
          </View>
        </View>
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <View style={styles.handleBar} />

            {/* Заглавие на падащото меню */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="map" size={19} color={COLORS.greenBright} />
                <Text style={styles.modalTitle}>Избери град в България</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsOpen(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Търсачка за градове */}
            <View style={styles.searchBox}>
              <Ionicons name="search" size={17} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Търси град, курорт или населено място..."
                placeholderTextColor={COLORS.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={COLORS.textMuted}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Бързи чипове за най-търсените градове, когато няма въведен текст */}
            {searchQuery.trim().length === 0 && (
              <View style={styles.quickSection}>
                <Text style={styles.quickSectionLabel}>
                  ⚡ Най-често избирани:
                </Text>
                <View style={styles.quickChipsWrap}>
                  {includeAllOption && (
                    <TouchableOpacity
                      style={[
                        styles.quickChip,
                        selectedCity === 'Всички градове' &&
                          styles.quickChipActive,
                      ]}
                      onPress={() => handleChoose('Всички градове')}
                    >
                      <Text
                        style={[
                          styles.quickChipText,
                          selectedCity === 'Всички градове' &&
                            styles.quickChipTextActive,
                        ]}
                      >
                        🌍 Всички градове
                      </Text>
                    </TouchableOpacity>
                  )}
                  {POPULAR_QUICK_CITIES.map((city) => {
                    const active = selectedCity === city;
                    const count = cityPostCounts?.[city.toLowerCase()] || 0;
                    return (
                      <TouchableOpacity
                        key={city}
                        style={[
                          styles.quickChip,
                          active && styles.quickChipActive,
                        ]}
                        onPress={() => handleChoose(city)}
                      >
                        <Text
                          style={[
                            styles.quickChipText,
                            active && styles.quickChipTextActive,
                          ]}
                        >
                          {city}
                          {count > 0 ? ` (${count})` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Опция за добавяне на собствено населено място, ако потребителят е написал нещо ново */}
            {searchQuery.trim().length >= 2 &&
              !filteredCities.some(
                (c) => c.toLowerCase() === searchQuery.trim().toLowerCase()
              ) && (
                <TouchableOpacity
                  style={styles.customCityOption}
                  onPress={() => handleChoose(searchQuery.trim())}
                >
                  <Ionicons
                    name="add-circle"
                    size={18}
                    color={COLORS.greenBright}
                  />
                  <Text style={styles.customCityOptionText}>
                    Избери населено място: „{searchQuery.trim()}“
                  </Text>
                </TouchableOpacity>
              )}

            {/* Пълен списък на градовете */}
            <FlatList
              data={filteredCities}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isSelected = selectedCity === item;
                const count =
                  item === 'Всички градове'
                    ? undefined
                    : cityPostCounts?.[item.toLowerCase()] || 0;

                return (
                  <TouchableOpacity
                    style={[
                      styles.cityRow,
                      isSelected && styles.cityRowSelected,
                    ]}
                    onPress={() => handleChoose(item)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.cityRowLeft}>
                      <Ionicons
                        name={
                          item === 'Всички градове'
                            ? 'globe-outline'
                            : isSelected
                            ? 'location'
                            : 'location-outline'
                        }
                        size={17}
                        color={
                          isSelected ? COLORS.greenBright : COLORS.textSecondary
                        }
                      />
                      <Text
                        style={[
                          styles.cityRowText,
                          isSelected && styles.cityRowTextSelected,
                        ]}
                      >
                        {item}
                      </Text>
                    </View>

                    <View style={styles.cityRowRight}>
                      {count !== undefined && count > 0 && (
                        <View style={styles.countBadge}>
                          <Text style={styles.countBadgeText}>
                            {count} сигнала
                          </Text>
                        </View>
                      )}
                      {isSelected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={19}
                          color={COLORS.greenBright}
                        />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 9.5,
    marginBottom: 9,
  },
  triggerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginRight: 8,
  },
  pinBadge: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: COLORS.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  triggerSubLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  triggerValue: {
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '800',
    marginTop: 1,
  },
  triggerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  clearCityBtn: {
    padding: 2,
  },
  chevronBox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: COLORS.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 14, 0.86)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bgSecondary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    maxHeight: '88%',
  },
  handleBar: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.borderStrong,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  closeBtn: {
    padding: 4,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10.5,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  quickSection: {
    marginBottom: 12,
  },
  quickSectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 7,
  },
  quickChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickChip: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 11,
    paddingVertical: 6.5,
    borderRadius: 999,
  },
  quickChipActive: {
    backgroundColor: COLORS.greenSoftBg,
    borderColor: COLORS.greenBorder,
  },
  quickChipText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  quickChipTextActive: {
    color: COLORS.greenBright,
    fontWeight: '800',
  },
  customCityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  customCityOptionText: {
    color: COLORS.greenBright,
    fontSize: 13,
    fontWeight: '800',
  },
  listContent: {
    paddingBottom: 20,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11.5,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
  },
  cityRowSelected: {
    backgroundColor: COLORS.greenSoftBg,
    borderBottomColor: 'transparent',
  },
  cityRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flex: 1,
  },
  cityRowText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  cityRowTextSelected: {
    color: COLORS.greenBright,
    fontWeight: '800',
  },
  cityRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    backgroundColor: COLORS.bgCardElevated,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
  },
  countBadgeText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
});
