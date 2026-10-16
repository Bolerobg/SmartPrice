import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLORS } from '@/constants/theme';
import { api, ApiError, AssistantAction, AssistantSuggestion, AssistantTopic } from '@/src/api/client';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/src/auth/AuthContext';
import { MarkdownText } from '@/components/MarkdownText';

/**
 * „Ценко“ — AI съветникът на SmartPrice.
 *
 * Защо е направен така:
 *   • Разговорът е с балончета (ляво/дясно) — най-познатият модел, нищо за учене.
 *   • Под всеки отговор излизат 2–3 бутона, които РЕАЛНО водят някъде. Така
 *     Ценко не само приказва — той „бута“ човека към действие.
 *   • Докато моделът мисли, се виждат три точки, а не празен екран.
 *   • Историята се пази на телефона (AsyncStorage), за да не се губи разговорът
 *     при презареждане на приложението.
 *   • Първият отворен чат не е измислен текст от клиента — Ценко поздравява с
 *     РЕАЛНИТЕ числа на човека (точки, находки), защото сървърът му ги дава.
 */

const STORAGE_KEY = '@smartprice_centko_v1';
const MAX_KEPT_MESSAGES = 60;
/** До колко стари съобщения пращаме на сървъра (пази разхода). */
const SEND_HISTORY = 12;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Простите стъпки, когато Ценко обяснява „как се прави“. */
  steps?: string[];
  mood?: string;
  suggestions?: AssistantSuggestion[];
  at: number;
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Резервни въпроси, ако темите от базата не се заредят. Иначе стартовите
 * бутончета идват от наръчника (assistant_knowledge) — тоест щом админът
 * добави нова тема, тук се появява нов бутон без нов билд.
 */
const STARTERS: Array<{ label: string; text: string; icon: string }> = [
  { label: 'Как да започна?', text: 'Как да започна с приложението? Първи стъпки.', icon: 'rocket' },
  { label: 'Как се качва находка?', text: 'Как се качва находка? Обясни ми с прости стъпки.', icon: 'add-circle' },
  { label: 'Как да снимам касова бележка?', text: 'Как да снимам касова бележка, за да я прочете AI?', icon: 'receipt' },
  { label: 'Как се печелят точки?', text: 'Как се печелят точки и значки?', icon: 'trophy' },
  { label: 'Къде е най-изгодно днес?', text: 'Къде е най-изгодно днес?', icon: 'trending-down' },
  { label: 'Как работи радарът?', text: 'Как работи радарът за цени?', icon: 'notifications' },
];

/** Икона за стартов бутон според темата от базата. */
const TOPIC_ICON: Record<string, string> = {
  basics: 'rocket',
  points: 'trophy',
  receipts: 'receipt',
  raffles: 'gift',
  safety: 'shield-checkmark',
  news: 'sparkles',
};

const MOOD_EMOJI: Record<string, string> = {
  весел: '😄',
  съпричастен: '🤝',
  игрив: '😜',
  горд: '😎',
  заинтригуван: '🤔',
};

/* ------------------------------------------------------------------ аватар */

const AssistantAvatar: React.FC<{ size?: number; pulse?: boolean }> = ({ size = 34, pulse }) => {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <LinearGradient
        colors={['#6366F1', '#06B6D4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: size * 0.52 }}>🦉</Text>
      </LinearGradient>
    </Animated.View>
  );
};

/* ------------------------------------------------- „мисли си“ (три точки) */

const ThinkingDots: React.FC = () => {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 320, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.thinkingRow}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[styles.thinkingDot, { opacity: d }]} />
      ))}
      <Text style={styles.thinkingText}>Ценко мисли…</Text>
    </View>
  );
};

/* ------------------------------------------------ лек markdown за балоните */

/**
 * Поддържа **удебелено**, *курсив* и редове, започващи с „• “ или „- “.
 * Пълен markdown не ни трябва — само това, което моделът реално ползва.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <Text key={`${keyPrefix}-b${i}`} style={styles.richBold}>
          {match[1]}
        </Text>
      );
    } else {
      parts.push(
        <Text key={`${keyPrefix}-i${i}`} style={styles.richItalic}>
          {match[2]}
        </Text>
      );
    }
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const RichText: React.FC<{ text: string; style?: object }> = ({ text, style }) => (
  <MarkdownText text={text} style={style} />
);

/* --------------------------------------------------------------- екран */

export default function AssistantScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ screen?: string }>();
  const fromScreen = typeof params.screen === 'string' ? params.screen : undefined;
  const { openDonationModal } = useApp();
  const { isAuthenticated } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [booted, setBooted] = useState(false);
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const [topics, setTopics] = useState<AssistantTopic[]>([]);

  const listRef = useRef<FlatList<ChatMessage>>(null);

  /* ---------------------------- темите за стартовите бутони (от базата) */
  useEffect(() => {
    void api
      .assistantTopics()
      .then((r) => setTopics(r.items ?? []))
      .catch(() => undefined);
  }, []);

  /* ------------------------------------------------ зареждане от диска */
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ChatMessage[];
          if (Array.isArray(parsed) && parsed.length) {
            setMessages(parsed.slice(-MAX_KEPT_MESSAGES));
            setBooted(true);
            return;
          }
        }
      } catch {
        // счупен кеш — просто започваме наново
      }
      setBooted(true);
    })();
  }, []);

  /* ------------------------------------------------ запис на диска */
  useEffect(() => {
    if (!booted) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_KEPT_MESSAGES))).catch(() => undefined);
  }, [messages, booted]);

  /* --------------------------------------------------- лимит (тихо) */
  useEffect(() => {
    void api
      .assistantQuota()
      .then((q) => setQuotaLeft(q.enabled ? q.left : null))
      .catch(() => undefined);
  }, []);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, []);

  /** Извиква сървъра и добавя отговора. */
  const ask = useCallback(
    async (question: string, opts: { greeting?: boolean } = {}) => {
      setBusy(true);
      try {
        const history = messages
          .filter((m) => m.role !== 'system')
          .slice(-SEND_HISTORY)
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));

        const answer = await api.assistantChat(
          opts.greeting
            ? { messages: history, greeting: true, screen: fromScreen }
            : {
                messages: [...history, { role: 'user' as const, content: question }],
                screen: fromScreen,
              }
        );

        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            text: answer.reply,
            steps: answer.steps ?? [],
            mood: answer.mood,
            suggestions: answer.suggestions,
            at: Date.now(),
          },
        ]);
        setQuotaLeft((n) => (n === null ? null : Math.max(0, n - 1)));
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.code === 'assistant_rate_limited'
              ? err.message
              : err.message
            : 'Нещо се обърка. Опитай пак.';
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            text: msg,
            at: Date.now(),
          },
        ]);
      } finally {
        setBusy(false);
        scrollToEnd();
      }
    },
    [messages, scrollToEnd, fromScreen]
  );

  /** Първи поздрав — само ако още няма разговор. */
  useEffect(() => {
    if (!booted || messages.length > 0 || busy) return;
    void ask('', { greeting: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);

  const send = useCallback(
    (text?: string) => {
      const value = (text ?? input).trim();
      if (!value || busy) return;
      setMessages((prev) => [...prev, { id: uid(), role: 'user', text: value, at: Date.now() }]);
      setInput('');
      scrollToEnd();
      void ask(value);
    },
    [ask, busy, input, scrollToEnd]
  );

  /* --------------------------------------------- какво прави бутонът */
  const runAction = useCallback(
    (action: AssistantAction) => {
      switch (action) {
        case 'add_post':
          if (!isAuthenticated) {
            router.push('/(auth)/register');
            return;
          }
          router.push('/(tabs)/add');
          return;
        case 'radar':
          router.push('/(tabs)/radar');
          return;
        case 'leaderboard':
          router.push('/(tabs)/community');
          return;
        case 'tour':
          router.push('/tour');
          return;
        case 'donate':
          openDonationModal('Ценко каза, че приложението живее от дарения. Подкрепи от 2 €!', true);
          return;
        case 'invite':
        case 'check_price':
        case 'nearby':
        default:
          router.push('/(tabs)/');
          return;
      }
    },
    [isAuthenticated, openDonationModal, router]
  );

  const clearChat = useCallback(async () => {
    setMessages([]);
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    setTimeout(() => void ask('', { greeting: true }), 120);
  }, [ask]);

  const listData = useMemo(() => messages, [messages]);
  const isEmpty = messages.length === 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* ---------------------------------------------------------- Хедър */}
      <View style={styles.header}>
        <AssistantAvatar size={38} pulse />
        <View style={{ flex: 1 }}>
          <View style={styles.headerNameRow}>
            <Text style={styles.headerName}>Ценко</Text>
            <View style={styles.onlinePill}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>на линия</Text>
            </View>
          </View>
          <Text style={styles.headerSub} numberOfLines={1}>
            AI съветник за всичко в SmartPrice
          </Text>
        </View>

        <TouchableOpacity style={styles.headerBtn} onPress={clearChat} accessibilityLabel="Нов разговор">
          <Ionicons name="refresh" size={17} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} accessibilityLabel="Затвори">
          <Ionicons name="close" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
      >
        <FlatList
          ref={listRef}
          data={listData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
          ListHeaderComponent={
            isEmpty && busy ? null : isEmpty ? (
              <View style={styles.introBox}>
                <AssistantAvatar size={54} />
                <Text style={styles.introTitle}>Здрасти, аз съм Ценко 🦉</Text>
                <Text style={styles.introText}>
                  Знам всичко за SmartPrice — цени, касови бележки, точки, значки, радар, томболи.
                  Питай ме каквото искаш или цъкни някое от предложенията долу.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.role === 'system') {
              return (
                <View style={styles.systemBubble}>
                  <Ionicons name="information-circle-outline" size={15} color={COLORS.goldBright} />
                  <Text style={styles.systemText}>{item.text}</Text>
                </View>
              );
            }

            if (item.role === 'user') {
              return (
                <View style={styles.userRow}>
                  <View style={styles.userBubble}>
                    <Text style={styles.userText}>{item.text}</Text>
                  </View>
                </View>
              );
            }

            return (
              <View style={styles.aiRow}>
                <AssistantAvatar size={30} />
                <View style={{ flex: 1 }}>
                  <View style={styles.aiBubble}>
                    <View style={styles.aiMetaRow}>
                      <Text style={styles.aiName}>Ценко</Text>
                      <Text style={styles.aiMood}>{MOOD_EMOJI[item.mood ?? ''] ?? '💬'}</Text>
                    </View>
                    <RichText text={item.text} />

                    {/* Стъпките — просто, номерирано, като за 10-годишно дете */}
                    {item.steps && item.steps.length > 0 && (
                      <View style={styles.stepsBox}>
                        {item.steps.map((s, idx) => (
                          <View key={`${item.id}-s${idx}`} style={styles.stepRow}>
                            <View style={styles.stepNum}>
                              <Text style={styles.stepNumText}>{idx + 1}</Text>
                            </View>
                            <Text style={styles.stepText}>{s}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>

                  {item.suggestions && item.suggestions.length > 0 && (
                    <View style={styles.suggestionsRow}>
                      {item.suggestions
                        .filter((s) => s.action !== 'none')
                        .map((s, idx) => (
                          <TouchableOpacity
                            key={`${item.id}-${idx}`}
                            style={styles.suggestionChip}
                            activeOpacity={0.85}
                            onPress={() => runAction(s.action)}
                          >
                            <Text style={styles.suggestionText}>{s.label}</Text>
                            <Ionicons name="arrow-forward" size={12} color={COLORS.accentCyan} />
                          </TouchableOpacity>
                        ))}
                    </View>
                  )}
                </View>
              </View>
            );
          }}
          ListFooterComponent={busy ? <ThinkingDots /> : null}
        />

        {/* --------------------------------------------------- Бързи въпроси */}
        {isEmpty && !busy && (
          <View style={styles.startersWrap}>
            {(topics.length > 0
              ? topics.map((t) => ({
                  label: t.title.replace(/\s*\(.*\)\s*$/, ''),
                  text: t.question,
                  icon: TOPIC_ICON[t.category] ?? 'help-circle',
                }))
              : STARTERS
            ).map((s) => (
              <TouchableOpacity key={s.label} style={styles.starterChip} activeOpacity={0.85} onPress={() => send(s.text)}>
                <Ionicons name={s.icon as never} size={14} color={COLORS.accentCyan} />
                <Text style={styles.starterText}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ------------------------------------------------------ Писане */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Питай Ценко нещо за приложението…"
            placeholderTextColor={COLORS.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            multiline
            maxLength={1000}
            editable={!busy}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || busy) && styles.sendBtnDisabled]}
            onPress={() => send()}
            disabled={!input.trim() || busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="send" size={17} color={COLORS.white} />
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footNote}>
          {quotaLeft !== null
            ? `Ценко има ${quotaLeft} ${quotaLeft === 1 ? 'отговор' : 'отговора'} на разположение този час.`
            : 'Ценко е AI и понякога може да сгреши — цените винаги ги проверявай на място.'}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
    backgroundColor: COLORS.bgSecondary,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerName: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 7,
  },
  onlineDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.greenBright,
  },
  onlineText: {
    color: COLORS.greenBright,
    fontSize: 9.5,
    fontWeight: '800',
  },
  headerSub: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgCardElevated,
  },
  listContent: {
    padding: 12,
    paddingBottom: 18,
  },
  introBox: {
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 14,
    gap: 8,
  },
  introTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  introText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  userRow: {
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  userBubble: {
    maxWidth: '86%',
    backgroundColor: COLORS.greenDark,
    borderRadius: 16,
    borderBottomRightRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  userText: {
    color: COLORS.white,
    fontSize: 14,
    lineHeight: 20,
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  aiBubble: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    borderTopLeftRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  aiMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  aiName: {
    color: COLORS.accentCyan,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  aiMood: {
    fontSize: 13,
  },
  richBase: {
    color: COLORS.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  richBold: {
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  richItalic: {
    fontStyle: 'italic',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 2,
  },
  bulletText: {
    flex: 1,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  /* Стъпките — номериран списък, който се чете с един поглед */
  stepsBox: {
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    gap: 7,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: {
    color: COLORS.accentCyan,
    fontSize: 11,
    fontWeight: '900',
  },
  stepText: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 13.5,
    lineHeight: 19,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  suggestionText: {
    color: COLORS.accentCyan,
    fontSize: 11.5,
    fontWeight: '800',
  },
  systemBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    marginBottom: 10,
    maxWidth: '92%',
  },
  systemText: {
    color: COLORS.goldBright,
    fontSize: 12,
    flexShrink: 1,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 38,
    paddingVertical: 8,
  },
  thinkingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accentCyan,
  },
  thinkingText: {
    color: COLORS.textMuted,
    fontSize: 11.5,
    marginLeft: 4,
  },
  startersWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  starterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
  },
  starterText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.greenPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.bgCardElevated,
  },
  footNote: {
    color: COLORS.textMuted,
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 4 : 8,
    paddingHorizontal: 16,
  },
});
