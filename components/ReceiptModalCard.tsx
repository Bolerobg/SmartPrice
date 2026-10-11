import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { PostPolarity, ReceiptData } from '@/types';

interface ReceiptModalCardProps {
  receipt: ReceiptData;
  polarity: PostPolarity;
}

export const ReceiptModalCard: React.FC<ReceiptModalCardProps> = ({ receipt, polarity }) => {
  const isGreen = polarity === 'green';

  return (
    <View style={styles.receiptPaper}>
      {/* Горен зигзаг / AI верификация */}
      <View style={styles.topHeader}>
        <View style={styles.aiVerifiedBadge}>
          <Ionicons name="shield-checkmark" size={15} color={COLORS.goldBright} />
          <Text style={styles.aiVerifiedText}>
            AI OCR СКАНИРАНА БЕЛЕЖКА • {Math.round(receipt.confidenceScore * 100)}% ТОЧНОСТ
          </Text>
        </View>
      </View>

      <View style={styles.merchantHeader}>
        <Text style={styles.merchantName}>{receipt.merchantName}</Text>
        {receipt.merchantTaxId && (
          <Text style={styles.merchantMeta}>ЕИК: {receipt.merchantTaxId}</Text>
        )}
        <Text style={styles.merchantMeta}>
          Дата: {receipt.date} {receipt.time ? `• Час: ${receipt.time}` : ''}
        </Text>
      </View>

      <View style={styles.dashedDivider} />

      {/* Списък с артикули */}
      <View style={styles.itemsList}>
        {receipt.items.map((item) => (
          <View key={item.id} style={styles.itemWrapper}>
            <View style={styles.itemRow}>
              <View style={styles.itemNameCol}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemQty}>
                  {item.quantity} x {item.unitPrice.toFixed(2)} {receipt.currency}
                </Text>
              </View>
              <Text style={styles.itemTotal}>
                {item.totalPrice.toFixed(2)} {receipt.currency}
              </Text>
            </View>

            {item.highlightReason && (
              <View
                style={[
                  styles.highlightPill,
                  {
                    backgroundColor: isGreen ? COLORS.greenSoftBg : COLORS.redSoftBg,
                    borderColor: isGreen ? COLORS.greenBorder : COLORS.redBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.highlightPillText,
                    { color: isGreen ? COLORS.greenBright : COLORS.redBright },
                  ]}
                >
                  {item.highlightReason}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>

      <View style={styles.dashedDivider} />

      {/* Обща сума */}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>ОБЩА СУМА ПО БОН:</Text>
        <Text
          style={[
            styles.totalAmount,
            { color: isGreen ? COLORS.greenBright : COLORS.redBright },
          ]}
        >
          {receipt.totalAmount.toFixed(2)} {receipt.currency}
        </Text>
      </View>

      {/* Снимка на самата бележка ако е качена от камерата */}
      {receipt.receiptImageUri && (
        <View style={styles.attachedReceiptPhotoBox}>
          <Text style={styles.attachedPhotoLabel}>Оригинална снимка на бележката:</Text>
          <Image
            source={{ uri: receipt.receiptImageUri }}
            style={styles.attachedReceiptImage}
            resizeMode="cover"
          />
        </View>
      )}

      <View style={styles.fiscalFooter}>
        <Ionicons name="qr-code-outline" size={22} color={COLORS.textMuted} />
        <Text style={styles.fiscalFooterText}>
          ФИСКАЛЕН БОН • ВЕРИФИЦИРАН ОТ SMARTPRICE AI
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  receiptPaper: {
    backgroundColor: '#131C2E',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: COLORS.goldBorder,
    padding: 16,
    marginVertical: 10,
  },
  topHeader: {
    alignItems: 'center',
    marginBottom: 10,
  },
  aiVerifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  aiVerifiedText: {
    color: COLORS.goldBright,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  merchantHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  merchantName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  merchantMeta: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  dashedDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderStrong,
    borderStyle: 'dashed',
    marginVertical: 10,
  },
  itemsList: {
    gap: 10,
  },
  itemWrapper: {
    gap: 5,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemNameCol: {
    flex: 1,
    marginRight: 10,
  },
  itemName: {
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '600',
  },
  itemQty: {
    color: COLORS.textMuted,
    fontSize: 11.5,
    marginTop: 1,
  },
  itemTotal: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  highlightPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  highlightPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  totalLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '900',
  },
  attachedReceiptPhotoBox: {
    marginTop: 12,
  },
  attachedPhotoLabel: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    marginBottom: 6,
  },
  attachedReceiptImage: {
    width: '100%',
    height: 150,
    borderRadius: 12,
  },
  fiscalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
  },
  fiscalFooterText: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
