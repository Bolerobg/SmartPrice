import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/constants/theme';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** Рамка около аватара (за „аз съм“ редове). */
  borderColor?: string;
}

function initialsOf(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Стабилен цвят от името — всеки човек получава свой, но винаги същия. */
function colorOf(name?: string | null): string {
  const palette = ['#6366F1', '#06B6D4', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6', '#EF4444'];
  const key = name ?? '';
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  return palette[hash % palette.length]!;
}

/**
 * Аватар с резервен вариант.
 *
 * Демо профилите (и новите потребители) нямат снимка — досега това оставяше
 * празно място в ранглистата, в потока и в коментарите. Сега показваме
 * инициали върху цвят, изведен от името, за да изглежда завършено.
 */
export const Avatar: React.FC<Props> = ({ uri, name, size = 42, borderColor }) => {
  const box = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: borderColor ? 2 : 0,
    borderColor: borderColor ?? 'transparent',
  } as const;

  if (uri) {
    return <Image source={{ uri }} style={box} />;
  }

  return (
    <View style={[box, styles.fallback, { backgroundColor: colorOf(name) }]}>
      <Text style={[styles.text, { fontSize: Math.max(11, Math.round(size * 0.36)) }]}>
        {initialsOf(name)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  text: { color: COLORS.white, fontWeight: '900', letterSpacing: 0.3 },
});
