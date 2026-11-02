// @refresh reset
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { CubeScene, type CubeStatus } from '../cube/CubeScene';

export type CubeHandle = {
  scramble: () => void;
  undo: () => void;
  reset: () => void;
  play: (token: string) => void;
};

type Props = {
  onStatus: (status: CubeStatus) => void;
  onReady: () => void;
};

export const CubeView = forwardRef<CubeHandle, Props>(function CubeView({ onStatus, onReady }, ref) {
  const sceneRef = useRef<CubeScene | null>(null);
  const onStatusRef = useRef(onStatus);
  const onReadyRef = useRef(onReady);
  const sizeRef = useRef({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  onStatusRef.current = onStatus;
  onReadyRef.current = onReady;

  useImperativeHandle(ref, () => ({
    scramble: () => sceneRef.current?.scramble(),
    undo: () => sceneRef.current?.undo(),
    reset: () => sceneRef.current?.reset(),
    play: (token: string) => sceneRef.current?.play(token),
  }), []);

  useEffect(() => () => sceneRef.current?.dispose(), []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const { locationX, locationY, touches } = event.nativeEvent;
        const scene = sceneRef.current;
        if (!scene) return;
        if (touches.length >= 2) scene.beginOrbit(locationX, locationY);
        else scene.pointerDown(locationX, locationY);
      },
      onPanResponderMove: (event) => {
        const { locationX, locationY, touches } = event.nativeEvent;
        const scene = sceneRef.current;
        if (!scene) return;
        if (touches.length >= 2) scene.beginOrbit(locationX, locationY);
        scene.pointerMove(locationX, locationY);
      },
      onPanResponderRelease: () => sceneRef.current?.pointerUp(),
      onPanResponderTerminate: () => sceneRef.current?.pointerUp(),
    }),
  ).current;

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    if (sceneRef.current) return;
    try {
      const scene = new CubeScene(gl, (status) => onStatusRef.current(status));
      sceneRef.current = scene;
      if (sizeRef.current.width > 0) {
        scene.setViewSize(sizeRef.current.width, sizeRef.current.height);
      }
      onReadyRef.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the cube');
    }
  };

  return (
    <View
      style={styles.stage}
      collapsable={false}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        sizeRef.current = { width, height };
        sceneRef.current?.setViewSize(width, height);
      }}
      {...pan.panHandlers}
    >
      <GLView style={styles.gl} onContextCreate={onContextCreate} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  gl: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  error: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 16,
    color: '#ffb4a8',
    textAlign: 'center',
  },
});
