import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { ProductPairPuzzle } from '@/components/ProductPairPuzzle';
import { api, ApiError, type PuzzleTile, type RaffleItem, type RaffleResults, type RaffleStanding } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { RaffleClaimModal } from '@/components/RaffleClaimModal';

type Phase = 'idle' | 'loading' | 'countdown' | 'playing';

const fmt = (ms: number | null | undefined) => {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
};

/** „след 12:05 мин“ / „след 2 ч 5 мин“ — за обратното броене до синхронния старт. */
const fmtWait = (seconds: number) => {
  if (seconds <= 0) return 'сега';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')} мин`;
  return `${s} сек`;
};

/** 20:00 — часът на отваряне, четим за човек. */
const clockTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** „8.42 с“ — за класацията е по-четимо от „0:08.4“. */
const secs = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} с`);

/** „14.10 15:32“ — кога точно се е случило. */
const when = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Малка плочка със статистика (участници, средно време, отстранени…). */
const Stat: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <View style={styles.resStatBox}>
    <Text style={styles.resStatVal}>{value}</Text>
    <Text style={styles.resStatLbl}>{label}</Text>
  </View>
);

/** Томбола: условия → тренировки → официално нареждане → класация. */
export default function RaffleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, profile } = useAuth();
  // Победителят: данните за доставка се подават от него, в приложението.
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimDone, setClaimDone] = useState(false);
  const [raffle, setRaffle] = useState<RaffleItem | null>(null);
  const [standings, setStandings] = useState<RaffleStanding[]>([]);
  // Пълните резултати (за всички) + дали е отворен одитният дневник.
  const [results, setResults] = useState<RaffleResults | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // „Часовник“ за обратното броене до синхронния старт. Тика само когато
  // има смисъл (зададен час и прозорецът още не е отворен), за да не хаби батерия.
  const [nowTick, setNowTick] = useState(Date.now());

  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<'practice' | 'official'>('practice');
  const [tiles, setTiles] = useState<PuzzleTile[]>([]);
  const [pairs, setPairs] = useState<string[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Обратно броене до синхронния старт. Тикаме всяка секунда САМО когато има
  // зададен час и прозорецът още не е отворен — иначе не пипаме нищо.
  const tickerNeeded = Boolean(raffle?.officialWindow?.synced && !raffle.officialWindow.open);
  useEffect(() => {
    if (!tickerNeeded) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [tickerNeeded]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.raffle(id);
      setRaffle(data.raffle);
      setStandings(data.standings || []);
      setResults(data.results ?? null);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Томболата не се зареди.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCountdown = useCallback((next: 'practice' | 'official', puzzleTiles: PuzzleTile[], puzzlePairs: string[]) => {
    setTiles(puzzleTiles);
    setPairs(puzzlePairs);
    setMode(next);
    setCountdown(3);
    setPhase('countdown');
  }, []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      setPhase('playing');
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => clearTimeout(timer);
  }, [phase, countdown]);

  const practice = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setNote(null);
    try {
      const puzzle = await api.rafflePuzzle(id, 'practice');
      startCountdown('practice', puzzle.tiles, puzzle.pairs);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Не успя да зареди пъзела.');
    } finally {
      setBusy(false);
    }
  }, [id, startCountdown]);

  const startOfficial = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setNote(null);
    try {
      await api.startRaffleRun(id);
      const puzzle = await api.rafflePuzzle(id, 'official');
      startCountdown('official', puzzle.tiles, puzzle.pairs);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Не успя да стартира нареждането.');
    } finally {
      setBusy(false);
    }
  }, [id, startCountdown]);

  const resumeOfficial = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      const puzzle = await api.rafflePuzzle(id, 'official');
      startCountdown('official', puzzle.tiles, puzzle.pairs);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Нареждането вече е приключило.');
      void load();
    } finally {
      setBusy(false);
    }
  }, [id, load, startCountdown]);

  const handleFinish = useCallback(
    async (timeMs: number) => {
      setPhase('idle');
      setTiles([]);
      if (!id) return;
      setBusy(true);
      try {
        if (mode === 'practice') {
          const res = await api.practiceRaffle(id, timeMs);
          setLastResult(
            `Тренировка: ${fmt(timeMs)} · остават ${res.practiceLeft} тренировки` +
              (res.bestPracticeMs ? ` · най-добро ${fmt(res.bestPracticeMs)}` : '')
          );
        } else {
          const res = await api.finishRaffleRun(id);
          setLastResult(`Официално време: ${fmt(res.timeMs)} · място #${res.place}`);
        }
        await load();
      } catch (err) {
        setNote(err instanceof ApiError ? err.message : 'Резултатът не се записа.');
      } finally {
        setBusy(false);
      }
    },
    [id, load, mode]
  );

  const join = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setNote(null);
    try {
      await api.joinRaffle(id);
      setLastResult('Включи се в томболата ✓');
      await load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Участието не успя.');
    } finally {
      setBusy(false);
    }
  }, [id, load]);

  const confirmOfficial = useCallback(() => {
    Alert.alert(
      'Официално нареждане',
      'Това е ЕДИНСТВЕНОТО нареждане, което се брои за класацията, и времето не може да се спре. Сигурен ли си?',
      [
        { text: 'Още малко тренировки', style: 'cancel' },
        { text: 'Старт', onPress: () => void startOfficial() },
      ]
    );
  }, [startOfficial]);

  const entry = raffle?.myEntry;
  const progress = raffle ? Math.min(raffle.myProgress ?? 0, raffle.conditionPosts) : 0;
  const canJoin = Boolean(raffle && !entry && progress >= raffle.conditionPosts && raffle.status === 'active');
  const canPractice = Boolean(entry && raffle && (entry.practiceLeft ?? 0) > 0 && entry.runTimeMs == null);
  // Синхронен старт: официалното нареждане е отворено само в прозореца.
  const syncAt = raffle?.officialWindow?.synced ? raffle.officialWindow : null;
  const secondsToOpen = syncAt?.opensAt
    ? Math.max(0, Math.round((new Date(syncAt.opensAt).getTime() - nowTick) / 1000))
    : 0;
  const secondsToClose = syncAt?.closesAt
    ? Math.max(0, Math.round((new Date(syncAt.closesAt).getTime() - nowTick) / 1000))
    : 0;
  const canRunOfficial = Boolean(
    entry &&
      raffle &&
      raffle.status === 'running' &&
      entry.runTimeMs == null &&
      !entry.runStarted &&
      (syncAt ? syncAt.open : true)
  );

  const statusText = useMemo(() => {
    if (!raffle) return '';
    switch (raffle.status) {
      case 'active':
        return 'Събират се участници';
      case 'running':
        return 'Нареждането е отворено — всеки нарежда по веднъж';
      case 'finished':
        return 'Томболата е разиграна';
      case 'cancelled':
        return 'Томболата е анулирана';
      default:
        return 'Чернова';
    }
  }, [raffle]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={COLORS.greenBright} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!raffle) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{note ?? 'Томболата не е намерена.'}</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.linkText}>Назад</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  /* ------------------------ Играта (пълноекранен режим) ------------------------ */
  if (phase === 'countdown' || phase === 'playing') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.gameWrap}>
          {phase === 'countdown' ? (
            <View style={styles.center}>
              <Text style={styles.countHuge}>{countdown > 0 ? countdown : 'ТРЪГНИ!'}</Text>
              <Text style={styles.countSub}>
                {mode === 'official'
                  ? 'Официално нареждане — времето тече от сървъра'
                  : 'Тренировка — не се брои за класацията'}
              </Text>
            </View>
          ) : (
            <ProductPairPuzzle
              tiles={tiles}
              targetPairs={pairs}
              badge={mode === 'official' ? 'ОФИЦИАЛНО НАРЕЖДАНЕ' : 'ТРЕНИРОВКА'}
              onFinish={(ms) => void handleFinish(ms)}
              onCancel={() => {
                setPhase('idle');
                void load();
              }}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Томбола</Text>
          <TouchableOpacity onPress={() => void load()} hitSlop={12}>
            <Ionicons name="refresh" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{raffle.title}</Text>
        <Text style={styles.status}>{statusText}</Text>
        {raffle.description ? <Text style={styles.desc}>{raffle.description}</Text> : null}

        {/* Наградата */}
        <View style={styles.prizeCard}>
          {raffle.prize.image ? (
            <Image source={{ uri: raffle.prize.image }} style={styles.prizeImage} resizeMode="cover" />
          ) : (
            <View style={[styles.prizeImage, styles.prizeFallback]}>
              <Ionicons name="trophy" size={40} color={COLORS.goldBright} />
            </View>
          )}
          <Text style={styles.prizeLabel}>НАГРАДАТА</Text>
          <Text style={styles.prizeTitle}>{raffle.prize.title}</Text>
          {raffle.prize.price ? (
            <Text style={styles.prizePrice}>{raffle.prize.price.toFixed(2)} €</Text>
          ) : null}
          {raffle.prize.url ? (
            <TouchableOpacity
              style={styles.prizeLink}
              onPress={() => void Linking.openURL(raffle.prize.url)}
              activeOpacity={0.85}
            >
              <Ionicons name="open-outline" size={15} color={COLORS.accentCyan} />
              <Text style={styles.prizeLinkText}>Виж продукта</Text>
            </TouchableOpacity>
          ) : null}

          {/* Спонсорът се казва честно: „награда от <спонсор>“ носи доверие. */}
          {raffle.sponsor ? (
            <TouchableOpacity
              style={styles.sponsorRow}
              activeOpacity={raffle.sponsor.url ? 0.8 : 1}
              onPress={() => raffle.sponsor?.url && void Linking.openURL(raffle.sponsor.url)}
            >
              <Ionicons name="ribbon-outline" size={14} color={COLORS.goldBright} />
              <Text style={styles.sponsorText}>
                Награда от <Text style={styles.sponsorName}>{raffle.sponsor.name}</Text>
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Победителят: тук дава данни за доставка */}
        {raffle.winnerId && profile?.id && raffle.winnerId === profile.id ? (
          <View style={styles.winBox}>
            <Text style={styles.winTitle}>🏆 Ти спечели тази награда!</Text>
            <Text style={styles.winText}>
              {claimDone
                ? 'Данните са получени. Ще получиш наградата с куриер — ще видиш номера на пратката тук.'
                : `Дай име, телефон и адрес, за да ти я изпратим${
                    raffle.claimDeadlineDays ? ` (до ${raffle.claimDeadlineDays} дни)` : ''
                  }.`}
            </Text>
            {!claimDone ? (
              <TouchableOpacity
                style={styles.winBtn}
                activeOpacity={0.9}
                onPress={() => setClaimOpen(true)}
              >
                <Ionicons name="gift" size={16} color={COLORS.black} />
                <Text style={styles.winBtnText}>Дай данни за доставка</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Модалът, с който победителят дава данни за доставка */}
        <RaffleClaimModal
          raffleId={raffle.id}
          visible={claimOpen}
          defaultName={profile?.name}
          defaultCity={profile?.city}
          deliveryNote={raffle.deliveryNote}
          claimDeadlineDays={raffle.claimDeadlineDays}
          onClose={() => setClaimOpen(false)}
          onDone={() => {
            setClaimOpen(false);
            setClaimDone(true);
          }}
        />

        {/* Правилата на томболата — за да няма изненади */}
        {raffle.rules ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Правила на томболата</Text>
            <Text style={styles.blockText}>{raffle.rules}</Text>
          </View>
        ) : null}

        {/* Условието */}
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Условие за участие</Text>
          <Text style={styles.blockText}>
            {raffle.conditionPosts} находки със снимка, качени в приложението
            {raffle.countFromStart ? ' (след началото на томболата)' : ''}
          </Text>

          <View style={styles.progressBarWrap}>
            <View style={[styles.progressBar, { width: `${Math.round((progress / raffle.conditionPosts) * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {progress} / {raffle.conditionPosts} находки
            {raffle.postsNeeded ? ` · още ${raffle.postsNeeded}` : ' · условието е покрито ✓'}
          </Text>
          {raffle.conditionDistinctDays && raffle.conditionDistinctDays > 1 ? (
            <Text style={styles.progressText}>
              Различни дни: {raffle.myDaysCount ?? 0} / {raffle.conditionDistinctDays}
              {raffle.daysNeeded ? ` · още ${raffle.daysNeeded}` : ' ✓'}
            </Text>
          ) : null}
          {raffle.winMode === 'first_to_complete' ? (
            <Text style={styles.hintLine}>
              Печели първият, който изпълни условието — не се нарежда пъзел.
            </Text>
          ) : null}

          {/* Гост: томболата се рекламира преди регистрация — тук обясняваме как
              се участва и водим към вход, вместо да показваме неактивен бутон. */}
          {!isAuthenticated ? (
            <>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => router.push('/(auth)/login' as never)}
                activeOpacity={0.88}
              >
                <Ionicons name="log-in-outline" size={17} color={COLORS.black} />
                <Text style={styles.primaryBtnText}>Влез и участвай безплатно</Text>
              </TouchableOpacity>
              <Text style={styles.waitText}>
                Участието е безплатно. Нужен е само профил — за да пазим находките ти и да
                измерим времето ти на пъзела.
              </Text>
            </>
          ) : entry ? (
            <View style={styles.entryRow}>
              <Ionicons name="checkmark-circle" size={17} color={COLORS.greenBright} />
              <Text style={styles.entryText}>Ти участваш в тази томбола</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, (!canJoin || busy) && styles.btnDisabled]}
              onPress={() => void join()}
              disabled={!canJoin || busy}
              activeOpacity={0.88}
            >
              <Ionicons name="ticket" size={17} color={COLORS.black} />
              <Text style={styles.primaryBtnText}>
                {progress >= raffle.conditionPosts ? 'Включи се в томболата' : `Нужни са още ${raffle.postsNeeded} находки`}
              </Text>
            </TouchableOpacity>
          )}

          {isAuthenticated && !entry && progress < raffle.conditionPosts ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.push('/(tabs)/add' as never)}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle-outline" size={17} color={COLORS.greenBright} />
              <Text style={styles.secondaryBtnText}>Качи находка сега</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Синхронен старт: казваме ЯСНО кога всички играят. Без това бутонът
            изглежда счупен, защото сървърът отказва игра извън прозореца. */}
        {syncAt && entry ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>
              {syncAt.open ? '🟢 Нареждането е отворено СЕГА' : '⏱ Синхронен старт'}
            </Text>
            <Text style={styles.blockText}>
              {syncAt.open
                ? `Всички играят в един и същи прозорец. Затваря след ${fmtWait(secondsToClose)} — побързай.`
                : `Официалното нареждане се отваря след ${fmtWait(secondsToOpen)} (в ${clockTime(syncAt.opensAt)} по твоето време) и трае ${raffle.officialWindowMin ?? 15} минути.`}
            </Text>
            {!syncAt.open ? (
              <Text style={styles.blockText}>
                Всички играят едновременно — затова никой не може да научи дъската с втори профил.
                Сложи си аларма малко преди часа.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Тренировки и официално нареждане */}
        {entry ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Нареждане на пъзела</Text>
            <Text style={styles.blockText}>
              Пъзелът: 12 плочки с реални продукти, сред тях 2 двойки еднакви. Намери и двете двойки
              — най-бързият печели.
            </Text>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{entry.practiceLeft}</Text>
                <Text style={styles.statLbl}>тренировки остават</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{fmt(entry.bestPracticeMs)}</Text>
                <Text style={styles.statLbl}>най-добра тренировка</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: COLORS.greenBright }]}>{fmt(entry.runTimeMs)}</Text>
                <Text style={styles.statLbl}>официално време</Text>
              </View>
            </View>

            {entry.runTimeMs == null ? (
              <TouchableOpacity
                style={[styles.secondaryBtn, (!canPractice || busy) && styles.btnDisabled]}
                onPress={() => void practice()}
                disabled={!canPractice || busy}
                activeOpacity={0.85}
              >
                <Ionicons name="game-controller-outline" size={17} color={COLORS.greenBright} />
                <Text style={styles.secondaryBtnText}>
                  {entry.practiceLeft > 0 ? `Тренировка (остават ${entry.practiceLeft})` : 'Тренировките са изчерпани'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {entry.runStarted ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => void resumeOfficial()} activeOpacity={0.88}>
                <Ionicons name="play" size={17} color={COLORS.black} />
                <Text style={styles.primaryBtnText}>Продължи официалното нареждане</Text>
              </TouchableOpacity>
            ) : null}

            {canRunOfficial ? (
              <TouchableOpacity
                style={[styles.primaryBtn, busy && styles.btnDisabled]}
                onPress={confirmOfficial}
                disabled={busy}
                activeOpacity={0.88}
              >
                <Ionicons name="trophy" size={17} color={COLORS.black} />
                <Text style={styles.primaryBtnText}>Стартирай официалното нареждане</Text>
              </TouchableOpacity>
            ) : null}

            {raffle.status === 'active' && entry.runTimeMs == null ? (
              <Text style={styles.waitText}>
                Официалното нареждане се отваря, когато томболата приключи събирането на участници.
              </Text>
            ) : null}
          </View>
        ) : null}

        {lastResult ? (
          <View style={styles.resultBox}>
            <Ionicons name="information-circle" size={16} color={COLORS.greenBright} />
            <Text style={styles.resultText}>{lastResult}</Text>
          </View>
        ) : null}

        {note ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={COLORS.goldBright} />
            <Text style={styles.errorBoxText}>{note}</Text>
          </View>
        ) : null}

        {/* 🏆 Прозрачни резултати. Виждат ги ВСИЧКИ — и който не е участвал.
            Идеята: загубилият да види, че не е измамен — кой за колко време се
            е справил, кога, колко тренировки е ползвал и какво е ставало. */}
        {results && results.final ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>🏆 Резултати</Text>

            {results.winner ? (
              <View style={styles.winnerBox}>
                <Ionicons name="trophy" size={21} color={COLORS.goldBright} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.winnerName} numberOfLines={1}>
                    {results.winner.name}
                  </Text>
                  <Text style={styles.winnerMeta}>
                    спечели с {secs(results.winner.timeMs)}
                    {results.winner.handle ? ` · ${results.winner.handle}` : ''}
                    {results.winner.isDemo && !results.demoMode ? ' · 🎭 демо (тест)' : ''}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.blockText}>
                Тази томбола остана без победител — виж статистиката и дневника по-долу.
              </Text>
            )}

            <View style={styles.statsGrid}>
              <Stat label="участници" value={results.stats.participants} />
              <Stat label="завършили" value={results.stats.finished} />
              <Stat label="най-бързо" value={secs(results.stats.fastestMs)} />
              <Stat label="средно време" value={secs(results.stats.averageMs)} />
              <Stat label="най-бавно" value={secs(results.stats.slowestMs)} />
              <Stat label="отстранени" value={results.stats.disqualified} />
            </View>

            <Text style={styles.tableHead}>Кой за колко време се справи</Text>
            {results.rows.length === 0 ? (
              <Text style={styles.blockText}>Нямаше участници.</Text>
            ) : (
              results.rows.map((row) => (
                <View key={row.userId} style={styles.resRow}>
                  <Text style={[styles.resRank, row.rank === 1 && { color: COLORS.goldBright }]}>
                    {row.rank ?? '—'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resName} numberOfLines={1}>
                      {row.name}
                      {row.isDemo && !results.demoMode ? ' · 🎭 демо' : ''}
                    </Text>
                    <Text style={styles.resWhen}>
                      {row.disqualified
                        ? 'отстранен след проверка — не се брои'
                        : row.runTimeMs != null
                          ? `игра ${when(row.runFinishedAt)} · тренировки ${row.practiceUsed}`
                          : 'не изигра официалното нареждане'}
                    </Text>
                  </View>
                  <Text style={[styles.resTime, row.disqualified && { color: COLORS.textMuted }]}>
                    {row.disqualified ? '—' : secs(row.runTimeMs)}
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.honesty}>
              Защо това е честно: времето се мери на сървъра, не на телефона; дъската е една и съща за всички;
              официалното нареждане се брои веднъж; тренировките не влизат в класацията. Отстранените участници
              се проверяват от организатора — броят им е посочен горе, но не ги посочваме поименно.
            </Text>

            {results.timeline.length > 0 ? (
              <TouchableOpacity
                style={styles.auditToggle}
                onPress={() => setShowAudit((v) => !v)}
                activeOpacity={0.85}
              >
                <Ionicons name={showAudit ? 'chevron-up' : 'chevron-down'} size={15} color={COLORS.accentCyan} />
                <Text style={styles.auditToggleText}>
                  {showAudit ? 'Скрий дневника на томболата' : `Виж дневника на томболата (${results.timeline.length})`}
                </Text>
              </TouchableOpacity>
            ) : null}

            {showAudit
              ? results.timeline.map((event, index) => (
                  <View key={`${event.kind}-${index}`} style={styles.auditRow}>
                    <Text style={styles.auditTime}>{when(event.at)}</Text>
                    <Text style={styles.auditText}>
                      {event.user ? `${event.user} — ` : ''}
                      {event.label}
                      {event.timeMs != null ? ` (${secs(event.timeMs)})` : ''}
                    </Text>
                  </View>
                ))
              : null}
          </View>
        ) : null}

        {/* Класация — само докато томболата тече. След края „Резултати“ горе
            показва същото, но по-подробно (с часове, тренировки, одит). */}
        {!(results && results.final) ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Класация ({standings.length})</Text>
            {standings.length === 0 ? (
              <Text style={styles.blockText}>Още никой не участва — бъди първи.</Text>
            ) : (
              standings.map((row) => (
                <View key={row.userId} style={styles.standingRow}>
                  <View style={[styles.rankPill, row.rank === 1 && { backgroundColor: COLORS.goldBright }]}>
                    <Text style={[styles.rankText, row.rank === 1 && { color: COLORS.black }]}>
                      {row.rank ?? '—'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.standingName} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={styles.standingMeta}>
                      {row.disqualified
                        ? 'дисквалифициран'
                        : row.runTimeMs != null
                          ? `време ${fmt(row.runTimeMs)}`
                          : row.practiceUsed > 0
                            ? `тренира ${row.practiceUsed}x · още не е наредил`
                            : 'участва'}
                    </Text>
                  </View>
                  {row.rank === 1 ? <Ionicons name="trophy" size={16} color={COLORS.goldBright} /> : null}
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sponsorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  sponsorText: { color: COLORS.textSecondary, fontSize: 12.5 },
  sponsorName: { color: COLORS.goldBright, fontWeight: '900' },
  winBox: {
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
  },
  winTitle: { color: COLORS.goldBright, fontSize: 17, fontWeight: '900' },
  winText: { color: COLORS.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  winBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: COLORS.goldBright,
  },
  winBtnText: { color: COLORS.black, fontSize: 14.5, fontWeight: '900' },
  hintLine: { color: COLORS.accentCyan, fontSize: 12.5, marginTop: 8, fontWeight: '700' },
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 18, paddingTop: 24, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  gameWrap: { flex: 1, padding: 18, justifyContent: 'center' },
  countHuge: { color: COLORS.greenBright, fontSize: 74, fontWeight: '900' },
  countSub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '900' },
  title: { color: COLORS.textPrimary, fontSize: 21, fontWeight: '900', marginTop: 16, lineHeight: 27 },
  status: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '800', marginTop: 6 },
  desc: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  prizeCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 18,
    padding: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  prizeImage: { width: '100%', height: 180, borderRadius: 14, backgroundColor: COLORS.bgCardElevated },
  prizeFallback: { alignItems: 'center', justifyContent: 'center' },
  prizeLabel: { color: COLORS.textMuted, fontSize: 9.5, fontWeight: '900', letterSpacing: 1.2, marginTop: 12 },
  prizeTitle: { color: COLORS.goldBright, fontSize: 17, fontWeight: '900', marginTop: 4, textAlign: 'center' },
  prizePrice: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '800', marginTop: 4 },
  prizeLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  prizeLinkText: { color: COLORS.accentCyan, fontSize: 12.5, fontWeight: '800' },
  block: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
  },
  blockTitle: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  blockText: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  progressBarWrap: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.bgCardElevated,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBar: { height: 8, borderRadius: 4, backgroundColor: COLORS.greenBright },
  progressText: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700', marginTop: 6 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  entryText: { color: COLORS.greenBright, fontSize: 12.5, fontWeight: '800' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBright,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 12,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 14, fontWeight: '900' },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 10,
  },
  secondaryBtnText: { color: COLORS.greenBright, fontSize: 13.5, fontWeight: '800' },
  waitText: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 10, lineHeight: 16 },
  statsRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '900' },
  statLbl: { color: COLORS.textMuted, fontSize: 9.5, fontWeight: '700', marginTop: 3, textAlign: 'center' },
  resultBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 12,
    padding: 11,
    marginTop: 12,
  },
  resultText: { flex: 1, color: COLORS.greenBright, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 12,
    padding: 11,
    marginTop: 12,
  },
  errorBoxText: { flex: 1, color: COLORS.goldBright, fontSize: 11.5, fontWeight: '700', lineHeight: 16 },
  errorText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  linkText: { color: COLORS.accentCyan, fontSize: 13, fontWeight: '800' },
  standingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  /* 🏆 Прозрачни резултати */
  winnerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  winnerName: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '900' },
  winnerMeta: { color: COLORS.goldBright, fontSize: 12, fontWeight: '800', marginTop: 2 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  resStatBox: {
    width: '31%',
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingVertical: 9,
    alignItems: 'center',
  },
  resStatVal: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  resStatLbl: { color: COLORS.textMuted, fontSize: 10, marginTop: 2, textAlign: 'center' },
  tableHead: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 2 },
  resRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  resRank: { width: 24, color: COLORS.textMuted, fontSize: 12.5, fontWeight: '900' },
  resName: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '700' },
  resWhen: { color: COLORS.textMuted, fontSize: 10.5, marginTop: 2 },
  resTime: { color: COLORS.greenBright, fontSize: 13, fontWeight: '900' },
  honesty: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
  auditToggle: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, paddingVertical: 6 },
  auditToggleText: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '800' },
  auditRow: { flexDirection: 'row', gap: 8, paddingVertical: 5 },
  auditTime: { color: COLORS.textMuted, fontSize: 10.5, width: 72 },
  auditText: { flex: 1, color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 16 },
  rankPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '900' },
  standingName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  standingMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
});
