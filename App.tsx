import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FACE_COLOR, type Face } from './src/cube/model';
import { CubeView, type CubeHandle } from './src/components/CubeView';
import { FACE_PAD, type CubeStatus } from './src/cube/CubeScene';

const INITIAL_STATUS: CubeStatus = {
  solveMoves: 0,
  solved: true,
  busy: false,
  lastMove: null,
  scrambling: false,
};

function formatTime(ms: number) {
  const clamped = Math.max(0, ms);
  const tenths = Math.floor(clamped / 100) % 10;
  const seconds = Math.floor(clamped / 1000) % 60;
  const minutes = Math.floor(clamped / 60000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

function chipInk(face: Face) {
  return face === 'U' || face === 'D' ? '#161616' : '#ffffff';
}

function statusLabel(status: CubeStatus, ready: boolean) {
  if (!ready) return 'Starting';
  if (status.scrambling) return 'Scrambling';
  if (status.solved && status.solveMoves > 0) return 'Solved';
  if (status.solved) return 'Ready';
  if (status.solveMoves === 0) return 'Scrambled';
  return 'Solving';
}

function CubeTutor() {
  const insets = useSafeAreaInsets();
  const cubeRef = useRef<CubeHandle>(null);
  const startedAt = useRef<number | null>(null);
  const wasSolving = useRef(false);
  const previousMoves = useRef(0);
  const [status, setStatus] = useState<CubeStatus>(INITIAL_STATUS);
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timing, setTiming] = useState(false);

  useEffect(() => {
    if (!timing) return undefined;
    const id = setInterval(() => {
      if (startedAt.current != null) setElapsed(Date.now() - startedAt.current);
    }, 100);
    return () => clearInterval(id);
  }, [timing]);

  const onStatus = (next: CubeStatus) => {
    setStatus(next);
    if (next.solveMoves > previousMoves.current && !next.scrambling) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    previousMoves.current = next.solveMoves;

    if (next.scrambling || (next.solved && next.solveMoves === 0)) {
      startedAt.current = null;
      setElapsed(0);
      setTiming(false);
      wasSolving.current = false;
      return;
    }

    if (!next.solved && startedAt.current == null && next.solveMoves > 0) {
      startedAt.current = Date.now();
      setElapsed(0);
      setTiming(true);
    }

    if (next.solved && next.solveMoves > 0) {
      if (startedAt.current != null) setElapsed(Date.now() - startedAt.current);
      setTiming(false);
      if (wasSolving.current) {
        wasSolving.current = false;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
      return;
    }

    wasSolving.current = !next.solved;
  };

  const controlsLocked = !ready || status.busy;
  const moveLabel = status.solveMoves === 1 ? 'move' : 'moves';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.kicker}>3×3</Text>
          <Text style={styles.brand}>CubeTutor</Text>
          <Text style={styles.phase}>{statusLabel(status, ready)}</Text>
        </View>
        <View style={styles.timerBlock}>
          <Text style={styles.timer}>{formatTime(elapsed)}</Text>
          <Text style={styles.moveCount}>
            {status.solveMoves} {moveLabel}
            {status.lastMove ? ` · ${status.lastMove}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.stage}>
        <CubeView ref={cubeRef} onStatus={onStatus} onReady={() => setReady(true)} />
        {status.solved && status.solveMoves > 0 ? (
          <View pointerEvents="none" style={styles.solvedWrap}>
            <View style={styles.solvedPill}>
              <Text style={styles.solvedText}>Solved</Text>
            </View>
          </View>
        ) : null}
      </View>

      <Text style={styles.hint}>Drag a face to turn a layer. Drag empty space to orbit.</Text>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scramble the cube"
            disabled={controlsLocked}
            onPress={() => cubeRef.current?.scramble()}
            style={({ pressed }) => [styles.primary, (pressed || controlsLocked) && styles.dim]}
          >
            <Text style={styles.primaryText}>{status.scrambling ? 'Scrambling' : 'Scramble'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo last move"
            disabled={controlsLocked || status.solveMoves === 0}
            onPress={() => cubeRef.current?.undo()}
            style={({ pressed }) => [
              styles.secondary,
              (pressed || controlsLocked || status.solveMoves === 0) && styles.dim,
            ]}
          >
            <Text style={styles.secondaryText}>Undo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset the cube"
            disabled={!ready}
            onPress={() => cubeRef.current?.reset()}
            style={({ pressed }) => [styles.secondary, (pressed || !ready) && styles.dim]}
          >
            <Text style={styles.secondaryText}>Reset</Text>
          </Pressable>
        </View>

        <View style={styles.pad}>
          {FACE_PAD.map((item) => (
            <Pressable
              key={item.token}
              accessibilityRole="button"
              accessibilityLabel={`Turn ${item.token}`}
              disabled={controlsLocked}
              onPress={() => cubeRef.current?.play(item.token)}
              style={({ pressed }) => [styles.chip, (pressed || controlsLocked) && styles.dim]}
            >
              <View style={[styles.chipFace, { backgroundColor: FACE_COLOR[item.face] }]}>
                <Text style={[styles.chipText, { color: chipInk(item.face) }]}>{item.token}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CubeTutor />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    height: '100%',
    backgroundColor: '#08090d',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  kicker: {
    color: '#8d97a8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  brand: {
    color: '#f4f6f8',
    fontSize: 28,
    fontWeight: '700',
    marginTop: 2,
  },
  phase: {
    color: '#9aa3b2',
    marginTop: 2,
    fontSize: 14,
  },
  timerBlock: {
    alignItems: 'flex-end',
  },
  timer: {
    color: '#f4f6f8',
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  moveCount: {
    color: '#9aa3b2',
    marginTop: 2,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  stage: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  solvedWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
  },
  solvedPill: {
    backgroundColor: '#f4f6f8',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  solvedText: {
    color: '#111111',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  hint: {
    color: '#8d97a8',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingBottom: 10,
    fontSize: 13,
  },
  dock: {
    zIndex: 2,
    backgroundColor: '#08090d',
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  primary: {
    flex: 1.4,
    backgroundColor: '#f4f6f8',
    borderRadius: 14,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#111111',
    fontWeight: '700',
    fontSize: 16,
  },
  secondary: {
    flex: 1,
    backgroundColor: '#171b24',
    borderRadius: 14,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  secondaryText: {
    color: '#f4f6f8',
    fontWeight: '600',
    fontSize: 16,
  },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    width: '25%',
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipFace: {
    alignSelf: 'stretch',
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontWeight: '800',
    fontSize: 16,
  },
  dim: {
    opacity: 0.45,
  },
});
