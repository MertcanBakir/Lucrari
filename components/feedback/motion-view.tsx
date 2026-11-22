import Reanimated, { LinearTransition } from 'react-native-reanimated';
import { useEffect, useRef, type PropsWithChildren } from 'react';
import { Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export function MotionView({ children, style, motionKey, active = true, rise = false }: PropsWithChildren<{
  style?: StyleProp<ViewStyle>; motionKey?: string | number | boolean; active?: boolean; rise?: boolean;
}>) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    progress.stopAnimation();
    if (reduced || !active) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [motionKey, active, reduced, progress]);
  return <Animated.View style={[style, {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }),
    transform: [{ translateY: rise ? progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) : 0 }],
  }]}>{children}</Animated.View>;
}

const layoutTransition = LinearTransition.duration(180);
export function LayoutMotionView({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const reduced = useReducedMotion();
  return <Reanimated.View style={style} layout={reduced ? undefined : layoutTransition}>{children}</Reanimated.View>;
}
