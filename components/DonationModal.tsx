import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, DONATION_TIERS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/src/api/client';

type TierId = 'coffee' | 'guardian' | 'legend';

export const DonationModal: React.FC = () => {
  const {
    isDonationModalOpen,
    isPeriodicNudge,
    donationPromptReason,
    snoozeDonationNudge,
    submitDonation,
    confirmDonationReturn,
    closeDonationModal,
    userProfile,
    paymentsEnabled,
  } = useApp();

  const [selectedTierId, setSelectedTierId] = useState<TierId>('guardian');
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isMonthly, setIsMonthly] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    message: string;
    amount: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedTier =
    DONATION_TIERS.find((t) => t.id === selectedTierId) || DONATION_TIERS[1]!;

  const customNumeric = Number(customAmount.replace(',', '.'));
  const hasCustomAmount = customAmount.trim() !== '' && Number.isFinite(customNumeric) && customNumeric > 0;
  const finalAmount = hasCustomAmount ? customNumeric : selectedTier.amount;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * След връщане от Stripe проверяваме реалния статус на плащането на сървъра.
   * Никога не отбелязваме „успешно“ само защото потребителят се е върнал.
   */
  const startPolling = useCallback(
    (sessionId: string, amount: number) => {
      stopPolling();
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const paid = await confirmDonationReturn(sessionId);
          if (paid) {
            stopPolling();
            setPendingSessionId(null);
            setSuccessInfo({
              message: 'Плащането е потвърдено. Благодарим ти за подкрепата!',
              amount,
            });
          }
        } catch {
          // продължаваме да опитваме
        }
        if (attempts >= 20) {
          stopPolling();
          setPendingSessionId(null);
          setError(
            'Плащането още не е потвърдено. Ако вече си платил, статусът ще се обнови автоматично при следващо отваряне на профила.'
          );
        }
      }, 3000);
    },
    [confirmDonationReturn, stopPolling]
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (!isDonationModalOpen) stopPolling();
  }, [isDonationModalOpen, stopPolling]);

  const handleDonate = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await submitDonation({
        amount: finalAmount,
        tierId: selectedTierId,
        isMonthly,
      });

      const canOpen = await Linking.canOpenURL(result.checkoutUrl).catch(() => false);
      if (canOpen) {
        await Linking.openURL(result.checkoutUrl);
      } else {
        throw new ApiError(0, 'cannot_open', 'Не успях да отворя защитената страница за плащане.');
      }

      setPendingSessionId(result.sessionId);
      startPolling(result.sessionId, finalAmount);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Плащането не можа да стартира. Опитай отново.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    stopPolling();
    setSuccessInfo(null);
    setError(null);
    setPendingSessionId(null);
    setCustomAmount('');
    if (pendingSessionId) void confirmDonationReturn(pendingSessionId).catch(() => undefined);
    closeDonationModal();
    void snoozeDonationNudge();
  };

  return (
    <Modal
      visible={isDonationModalOpen}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Декоративен хендъл */}
          <View style={styles.handleBar} />

          {successInfo ? (
            <View style={styles.successContainer}>
              <View style={styles.successIconCircle}>
                <Ionicons name="shield-checkmark" size={48} color={COLORS.goldBright} />
              </View>
              <Text style={styles.successTitle}>Ти вече си Пазител на Общността!</Text>
              <Text style={styles.successSub}>{successInfo.message}</Text>

              <View style={styles.receiptBox}>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Дарена сума:</Text>
                  <Text style={styles.receiptValue}>
                    {successInfo.amount.toFixed(2)} € {isMonthly ? '(Месечно)' : '(Еднократно)'}
                  </Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Обработка:</Text>
                  <Text style={styles.receiptValue}>Потвърдено плащане</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Статус на напомнянията:</Text>
                  <Text style={[styles.receiptValue, { color: COLORS.greenBright }]}>
                    ✓ Спрени (VIP Дарител)
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.doneButton}
                onPress={handleClose}
                activeOpacity={0.85}
              >
                <Text style={styles.doneButtonText}>Обратно към SmartPrice</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Бадж за периодично напомняне */}
              <View style={styles.topRow}>
                <View
                  style={[
                    styles.nudgeBadge,
                    isPeriodicNudge && {
                      backgroundColor: 'rgba(244, 63, 94, 0.16)',
                      borderColor: COLORS.redBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name={isPeriodicNudge ? 'notifications' : 'heart'}
                    size={13}
                    color={isPeriodicNudge ? COLORS.redBright : COLORS.goldBright}
                  />
                  <Text
                    style={[
                      styles.nudgeBadgeText,
                      isPeriodicNudge && { color: COLORS.redBright },
                    ]}
                  >
                    {isPeriodicNudge
                      ? 'ПЕРИОДИЧНО НАПОМНЯНЕ • НЕ СИ ДАРИЛ ВСЕ ОЩЕ'
                      : '100% НЕЗАВИСИМА ОБЩНОСТ • БЕЗ РЕКЛАМИ'}
                  </Text>
                </View>

                <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalTitle}>
                Подкрепи честните цени в България 🇧🇬
              </Text>
              <Text style={styles.modalReason}>{donationPromptReason}</Text>

              {/* Статистика за прозрачност */}
              <View style={styles.impactBanner}>
                <View style={styles.impactItem}>
                  <Text style={styles.impactValue}>0 €</Text>
                  <Text style={styles.impactLabel}>От платени реклами</Text>
                </View>
                <View style={styles.impactDivider} />
                <View style={styles.impactItem}>
                  <Text style={[styles.impactValue, { color: COLORS.greenBright }]}>
                    {userProfile.personalSavedBgn} €
                  </Text>
                  <Text style={styles.impactLabel}>Твои спестени пари</Text>
                </View>
                <View style={styles.impactDivider} />
                <View style={styles.impactItem}>
                  <Text style={[styles.impactValue, { color: COLORS.goldBright }]}>
                    0
                  </Text>
                  <Text style={styles.impactLabel}>Платени ревюта</Text>
                </View>
              </View>

              {/* Еднократно vs Месечно */}
              <View style={styles.frequencySegment}>
                <TouchableOpacity
                  style={[
                    styles.freqOption,
                    !isMonthly && styles.freqOptionActive,
                  ]}
                  onPress={() => setIsMonthly(false)}
                >
                  <Text
                    style={[
                      styles.freqOptionText,
                      !isMonthly && styles.freqOptionTextActive,
                    ]}
                  >
                    Еднократно дарение
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.freqOption,
                    isMonthly && styles.freqOptionActive,
                  ]}
                  onPress={() => setIsMonthly(true)}
                >
                  <Text
                    style={[
                      styles.freqOptionText,
                      isMonthly && styles.freqOptionTextActive,
                    ]}
                  >
                    🔄 Месечна подкрепа
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Избор на сума (Tiers) */}
              <Text style={styles.sectionLabel}>Избери сума за дарение:</Text>
              <View style={styles.tiersContainer}>
                {DONATION_TIERS.map((tier) => {
                  const isSelected =
                    selectedTierId === tier.id && customAmount.trim() === '';
                  return (
                    <TouchableOpacity
                      key={tier.id}
                      style={[
                        styles.tierCard,
                        isSelected && styles.tierCardSelected,
                      ]}
                      onPress={() => {
                        setSelectedTierId(tier.id as any);
                        setCustomAmount('');
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={styles.tierLeft}>
                        <Text style={styles.tierEmoji}>{tier.emoji}</Text>
                        <View style={{ flex: 1 }}>
                          <View style={styles.tierTitleRow}>
                            <Text style={styles.tierTitle}>{tier.title}</Text>
                            {tier.popular && (
                              <View style={styles.popularTag}>
                                <Text style={styles.popularTagText}>НАЙ-ИЗБИРАН</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.tierSub}>{tier.subtitle}</Text>
                        </View>
                      </View>
                      <View style={styles.tierPriceCol}>
                        <Text
                          style={[
                            styles.tierPriceBgn,
                            isSelected && { color: COLORS.goldBright },
                          ]}
                        >
                          {tier.amount} €
                        </Text>
                        <Text style={styles.tierPriceEur}>еднократно</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Поле за произволна сума */}
              <View style={styles.customAmountBox}>
                <Text style={styles.customAmountLabel}>Или въведи друга сума (€):</Text>
                <TextInput
                  style={styles.customAmountInput}
                  placeholder="напр. 15"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="numeric"
                  value={customAmount}
                  onChangeText={setCustomAmount}
                />
              </View>

              {/* Плащане през Stripe Checkout (реална страница на Stripe) */}
              <Text style={styles.sectionLabel}>Плащане:</Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 9,
                  backgroundColor: paymentsEnabled ? COLORS.greenSoftBg : COLORS.goldSoftBg,
                  borderWidth: 1,
                  borderColor: paymentsEnabled ? COLORS.greenBorder : COLORS.goldBorder,
                  borderRadius: 12,
                  padding: 11,
                }}
              >
                <Ionicons
                  name={paymentsEnabled ? 'lock-closed' : 'construct'}
                  size={17}
                  color={paymentsEnabled ? COLORS.greenBright : COLORS.goldBright}
                />
                <Text
                  style={{
                    flex: 1,
                    color: paymentsEnabled ? COLORS.greenBright : COLORS.goldBright,
                    fontSize: 11.5,
                    fontWeight: '700',
                    lineHeight: 17,
                  }}
                >
                  {paymentsEnabled
                    ? 'Ще бъдеш пренасочен към защитената страница за плащане. Картата се въвежда само там — приложението не я вижда.'
                    : 'Плащанията в момента не са достъпни. Опитай отново по-късно.'}
                </Text>
              </View>

              {/* Доверие: неща, които българският потребител ПОЗНАВА.
                  Име на доставчик не помага тук — затова картите, катинарът,
                  3D Secure и „не пазим данните“ вършат тази работа. */}
              {paymentsEnabled && (
                <View style={styles.trustCard}>
                  <Text style={styles.trustTitle}>Можеш да платиш с</Text>

                  {/* Карти */}
                  <View style={styles.brandRow}>
                    <View style={[styles.brandBadge, { backgroundColor: '#1A1F71' }]}>
                      <Text style={[styles.brandText, { fontStyle: 'italic' }]}>VISA</Text>
                    </View>
                    <View style={[styles.brandBadge, { backgroundColor: '#16181D' }]}>
                      <View style={styles.mcCircles}>
                        <View style={[styles.mcCircle, { backgroundColor: '#EB001B' }]} />
                        <View style={[styles.mcCircle, { backgroundColor: '#F79E1B', marginLeft: -7 }]} />
                      </View>
                      <Text style={styles.brandText}>mastercard</Text>
                    </View>
                    <View style={[styles.brandBadge, { backgroundColor: '#0F4C9C' }]}>
                      <Text style={styles.brandText}>Maestro</Text>
                    </View>
                  </View>

                  {/* Мобилни портфейли — показват се само на устройството, което ги има */}
                  <View style={[styles.brandRow, { marginTop: -4 }]}>
                    <View style={[styles.brandBadge, styles.walletBadge, { backgroundColor: '#000000' }]}>
                      <Ionicons name="logo-apple" size={15} color={COLORS.white} />
                      <Text style={styles.brandText}>Pay</Text>
                    </View>
                    <View
                      style={[
                        styles.brandBadge,
                        styles.walletBadge,
                        { backgroundColor: COLORS.white },
                      ]}
                    >
                      <Ionicons name="logo-google" size={14} color="#4285F4" />
                      <Text style={[styles.brandText, { color: '#3C4043' }]}>Pay</Text>
                    </View>
                    <Text style={styles.walletHint}>на телефона</Text>
                  </View>

                  <View style={styles.trustRow}>
                    <Ionicons name="lock-closed" size={14} color={COLORS.greenBright} />
                    <Text style={styles.trustText}>
                      <Text style={styles.trustStrong}>Защитено плащане</Text> — данните пътуват
                      криптирано.
                    </Text>
                  </View>

                  <View style={styles.trustRow}>
                    <Ionicons name="phone-portrait-outline" size={14} color={COLORS.accentCyan} />
                    <Text style={styles.trustText}>
                      Потвърждаваш с <Text style={styles.trustStrong}>SMS от банката</Text> (3D Secure).
                    </Text>
                  </View>

                  <View style={styles.trustRow}>
                    <Ionicons name="eye-off-outline" size={14} color={COLORS.accentCyan} />
                    <Text style={styles.trustText}>
                      <Text style={styles.trustStrong}>Не пазим данните на картата ти.</Text> Те
                      остават само в банката.
                    </Text>
                  </View>

                  <View style={styles.trustRow}>
                    <Ionicons name="shield-checkmark" size={14} color={COLORS.goldBright} />
                    <Text style={styles.trustText}>
                      Плащаш на страницата на банката — <Text style={styles.trustStrong}>не в приложението</Text>.
                    </Text>
                  </View>
                </View>
              )}

              {pendingSessionId && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    backgroundColor: COLORS.bgCardElevated,
                    borderRadius: 12,
                    padding: 11,
                    marginTop: 8,
                  }}
                >
                  <ActivityIndicator size="small" color={COLORS.accentCyan} />
                  <Text style={{ flex: 1, color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '700' }}>
                    Чакам потвърждение за плащането…
                  </Text>
                </View>
              )}

              {error && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: COLORS.redSoftBg,
                    borderWidth: 1,
                    borderColor: COLORS.redBorder,
                    borderRadius: 12,
                    padding: 11,
                    marginTop: 8,
                  }}
                >
                  <Ionicons name="alert-circle" size={16} color={COLORS.redBright} />
                  <Text style={{ flex: 1, color: COLORS.redBright, fontSize: 11.5, fontWeight: '700' }}>
                    {error}
                  </Text>
                </View>
              )}

              {/* Главен бутон за дарение */}
              <TouchableOpacity
                style={[styles.stripeDonateBtn, (!paymentsEnabled || isProcessing) && { opacity: 0.5 }]}
                onPress={handleDonate}
                disabled={!paymentsEnabled || isProcessing}
                activeOpacity={0.88}
              >
                {isProcessing ? (
                  <ActivityIndicator color={COLORS.black} />
                ) : (
                  <>
                    <Ionicons name="lock-closed" size={17} color={COLORS.black} />
                    <Text style={styles.stripeDonateBtnText}>
                      Подкрепи с {finalAmount.toFixed(2)} €{' '}
                      {isMonthly ? '/ месец' : ''}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Бутон „Напомни ми по-късно“ */}
              <TouchableOpacity
                style={styles.remindLaterBtn}
                onPress={handleClose}
              >
                <Text style={styles.remindLaterText}>
                  Все още не мога — напомни ми отново по-късно
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 14, 0.82)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bgSecondary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  handleBar: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.borderStrong,
    alignSelf: 'center',
    marginBottom: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  nudgeBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  nudgeBadgeText: {
    color: COLORS.goldBright,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  closeBtn: {
    padding: 4,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 21,
    fontWeight: '900',
    marginBottom: 6,
  },
  modalReason: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: 14,
  },
  impactBanner: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingVertical: 11,
    marginBottom: 14,
  },
  impactItem: {
    flex: 1,
    alignItems: 'center',
  },
  impactDivider: {
    width: 1,
    backgroundColor: COLORS.borderSubtle,
  },
  impactValue: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  impactLabel: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    marginTop: 2,
  },
  frequencySegment: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderRadius: 13,
    padding: 4,
    marginBottom: 14,
  },
  freqOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  freqOptionActive: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
  },
  freqOptionText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  freqOptionTextActive: {
    color: COLORS.goldBright,
    fontWeight: '800',
  },
  sectionLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  tiersContainer: {
    gap: 9,
    marginBottom: 12,
  },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1.2,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 12,
  },
  tierCardSelected: {
    borderColor: COLORS.goldPrimary,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  tierLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  tierEmoji: {
    fontSize: 26,
  },
  tierTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tierTitle: {
    color: COLORS.textPrimary,
    fontSize: 14.5,
    fontWeight: '800',
  },
  popularTag: {
    backgroundColor: COLORS.goldPrimary,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  popularTagText: {
    color: COLORS.black,
    fontSize: 9,
    fontWeight: '900',
  },
  tierSub: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    marginTop: 2,
  },
  tierPriceCol: {
    alignItems: 'flex-end',
  },
  tierPriceBgn: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  tierPriceEur: {
    color: COLORS.textMuted,
    fontSize: 11,
  },
  customAmountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 14,
  },
  customAmountLabel: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  customAmountInput: {
    color: COLORS.goldBright,
    fontSize: 15,
    fontWeight: '800',
    minWidth: 85,
    textAlign: 'right',
    paddingVertical: 4,
  },
  paymentMethodsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  pmChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingVertical: 10,
    borderRadius: 12,
  },
  pmChipActive: {
    borderColor: COLORS.goldPrimary,
    backgroundColor: COLORS.goldSoftBg,
  },
  pmChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  stripeDonateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.goldBright,
    paddingVertical: 15,
    borderRadius: 16,
    marginBottom: 10,
  },
  stripeDonateBtnText: {
    color: COLORS.black,
    fontSize: 15.5,
    fontWeight: '900',
  },
  remindLaterBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  remindLaterText: {
    color: COLORS.textMuted,
    fontSize: 12.5,
    fontWeight: '600',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  successIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 2,
    borderColor: COLORS.goldPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  successTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 6,
  },
  successSub: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  receiptBox: {
    width: '100%',
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 14,
    gap: 8,
    marginBottom: 18,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  receiptLabel: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
  },
  receiptValue: {
    color: COLORS.textPrimary,
    fontSize: 12.5,
    fontWeight: '800',
  },
  trustCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    padding: 13,
    marginTop: 10,
  },
  trustTitle: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  brandRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 13 },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 7,
    minWidth: 62,
  },
  brandText: { color: COLORS.white, fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  walletBadge: { borderWidth: 1, borderColor: 'rgba(148,163,184,0.35)' },
  walletHint: {
    alignSelf: 'center',
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  mcCircles: { flexDirection: 'row', alignItems: 'center' },
  mcCircle: { width: 13, height: 13, borderRadius: 7, opacity: 0.95 },
  trustRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 9 },
  trustText: { flex: 1, color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 17 },
  trustStrong: { color: COLORS.textPrimary, fontWeight: '800' },
  doneButton: {
    width: '100%',
    backgroundColor: COLORS.greenPrimary,
    paddingVertical: 14,
    borderRadius: 15,
    alignItems: 'center',
  },
  doneButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
  },
});
