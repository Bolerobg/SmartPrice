import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/constants/theme';

/**
 * Markdown за отговорите на Ценко.
 *
 * Защо собствен, а не библиотека: трябва ни малко (удебелено, курсив, код,
 * списъци, заглавия, линкове, разделител) и трябва да изглежда ЕДНАКВО в
 * приложението и в браузъра. Библиотека би донесла 200 KB и свой шрифт, а ние
 * искаме отговорът да е четлив, подреден и с иконки — точно както Ценко пише.
 *
 * Поддържа:
 *   **удебелено**  *курсив*  `код`  [текст](линк)
 *   ## Заглавие    • списък     1. номериран списък
 *   > важно       --- разделител        ``` блок код ```
 */
interface Props {
  text: string;
  style?: object;
}

const INLINE =
  /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-${i++}`;

    if (token.startsWith('**') && token.endsWith('**')) {
      out.push(
        <Text key={key} style={styles.bold}>
          {token.slice(2, -2)}
        </Text>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      out.push(
        <Text key={key} style={styles.code}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      out.push(
        <Text key={key} style={styles.italic}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith('[')) {
      const label = /\[([^\]]+)\]/.exec(token)?.[1] ?? token;
      const href = /\(([^)]+)\)/.exec(token)?.[1] ?? '';
      out.push(
        <Text
          key={key}
          style={styles.link}
          onPress={() => {
            if (href) void Linking.openURL(href).catch(() => undefined);
          }}
        >
          {label}
        </Text>
      );
    } else {
      out.push(
        <Text
          key={key}
          style={styles.link}
          onPress={() => void Linking.openURL(token).catch(() => undefined)}
        >
          {token}
        </Text>
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const MarkdownText: React.FC<Props> = ({ text, style }) => {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let codeBuffer: string[] | null = null;

  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '');

    // Блок код (``` … ```) — моноширинен, за да не се чупи подравняването.
    if (/^\s*```/.test(line)) {
      if (codeBuffer) {
        blocks.push(
          <View key={`code-${idx}`} style={styles.codeBlock}>
            <Text style={styles.codeBlockText}>{codeBuffer.join('\n')}</Text>
          </View>
        );
        codeBuffer = null;
      } else {
        codeBuffer = [];
      }
      return;
    }
    if (codeBuffer) {
      codeBuffer.push(raw);
      return;
    }

    // Празен ред — само въздух, не текст.
    if (!line.trim()) {
      blocks.push(<View key={`gap-${idx}`} style={styles.gap} />);
      return;
    }

    // Разделител
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<View key={`hr-${idx}`} style={styles.hr} />);
      return;
    }

    // Заглавия: ##, ### (и # също)
    const heading = /^\s*(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(
        <Text
          key={`h-${idx}`}
          style={[styles.base, level <= 2 ? styles.h2 : styles.h3, style]}
        >
          {renderInline(heading[2]!, `h${idx}`)}
        </Text>
      );
      return;
    }

    // Цитат / важно
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push(
        <View key={`q-${idx}`} style={styles.quoteBox}>
          <Text style={[styles.base, styles.quoteText, style]}>
            {renderInline(quote[1]!, `q${idx}`)}
          </Text>
        </View>
      );
      return;
    }

    // Номериран ред: „1. “ или „1) “
    const numbered = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push(
        <View key={`n-${idx}`} style={styles.listRow}>
          <Text style={[styles.base, styles.listNum, style]}>{numbered[1]}.</Text>
          <Text style={[styles.base, styles.listText, style]}>
            {renderInline(numbered[2]!, `n${idx}`)}
          </Text>
        </View>
      );
      return;
    }

    // Точка: „• “, „- “, „* “, „– “
    const bullet = /^\s*[•\-*–]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push(
        <View key={`b-${idx}`} style={styles.listRow}>
          <Text style={[styles.base, styles.listBullet, style]}>•</Text>
          <Text style={[styles.base, styles.listText, style]}>
            {renderInline(bullet[1]!, `b${idx}`)}
          </Text>
        </View>
      );
      return;
    }

    // Обикновен абзац
    blocks.push(
      <Text key={`p-${idx}`} style={[styles.base, style]}>
        {renderInline(line, `p${idx}`)}
      </Text>
    );
  });

  // Ако текстът свърши, а блок кодът е отворен — показваме каквото имаме.
  if (codeBuffer && codeBuffer.length) {
    blocks.push(
      <View key="code-tail" style={styles.codeBlock}>
        <Text style={styles.codeBlockText}>{codeBuffer.join('\n')}</Text>
      </View>
    );
  }

  return <View>{blocks}</View>;
};

const styles = StyleSheet.create({
  base: { color: COLORS.textPrimary, fontSize: 14.5, lineHeight: 21.5 },
  bold: { fontWeight: '800', color: COLORS.textPrimary },
  italic: { fontStyle: 'italic' },
  code: {
    fontFamily: 'monospace',
    fontSize: 13.5,
    color: COLORS.accentCyan,
    backgroundColor: 'rgba(6, 182, 212, 0.10)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  link: { color: COLORS.accentCyan, textDecorationLine: 'underline' },
  h2: { fontSize: 17, fontWeight: '900', marginTop: 2, marginBottom: 2 },
  h3: { fontSize: 15.5, fontWeight: '800', marginTop: 2 },
  gap: { height: 8 },
  hr: { height: 1, backgroundColor: 'rgba(148, 163, 184, 0.28)', marginVertical: 8 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 5 },
  listBullet: { color: COLORS.accentCyan, fontWeight: '900', width: 12 },
  listNum: { color: COLORS.accentCyan, fontWeight: '900', minWidth: 16 },
  listText: { flex: 1 },
  quoteBox: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.goldBright,
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginVertical: 5,
  },
  quoteText: { color: COLORS.textPrimary },
  codeBlock: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    borderRadius: 10,
    padding: 10,
    marginVertical: 6,
  },
  codeBlockText: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
    color: COLORS.textSecondary,
  },
});
