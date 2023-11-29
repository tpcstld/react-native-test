/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import Reanimated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import React from 'react';
import {StyleSheet} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: 'blue',
  },
  rectangle: {
    width: '100%',
    backgroundColor: 'red',
  },
});

export default function App(): JSX.Element {
  const height = useSharedValue(100);

  const style = useAnimatedStyle(() => {
    return {
      height: withSpring(height.value),
    };
  });

  const gesture = React.useMemo(() => {
    return Gesture.Pan()
      .enabled(true)
      .onChange(event => {
        height.value = Math.max(0, height.value + event.changeY);
      });
  }, [height]);

  // useAnimatedReaction(
  //   () => height.value,
  //   value => {
  //     console.log('htht', value);
  //   },
  // );

  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={gesture}>
        <Reanimated.View style={styles.container}>
          <Reanimated.View style={[styles.rectangle, style]} />
        </Reanimated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
