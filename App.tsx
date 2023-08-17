/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from 'react';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {Pressable, View, StyleSheet, Text} from 'react-native';

function App(): JSX.Element {
  const [value, setValue] = React.useState(false);

  const height = useSharedValue(100);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: 'red',
      height: height.value,
      width: '100%',
    };
  }, []);

  const animate = React.useCallback(() => {
    setValue(v => !v);
    height.value = height.value === 100 ? 200 : 100;
  }, [height]);

  const foo = useAnimatedStyle(() => {
    return {
      backgroundColor: 'green',
      flex: 1,
    };
  }, []);

  return (
    <View style={styles.container}>
      <Reanimated.View style={animatedStyle}>
        <Reanimated.View key={value ? 1 : 2} style={foo} />
      </Reanimated.View>
      <Pressable onPress={animate} style={styles.button}>
        <Text>Press Me</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: '100%',
  },
  button: {
    position: 'absolute',
    bottom: 100,
  },
});

export default App;
