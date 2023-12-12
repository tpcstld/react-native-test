/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from 'react';
import {
  Button,
  LayoutChangeEvent,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {Freeze} from 'react-freeze';

export default function App(): JSX.Element {
  const [freeze, setFreeze] = React.useState(false);
  const [lastLayout, setLastLayout] = React.useState({width: 0, height: 0});

  function handlePress() {
    setFreeze(!freeze);
  }

  function handleLayout(e: LayoutChangeEvent) {
    const {width, height} = e.nativeEvent.layout;
    setLastLayout({width, height});
  }

  return (
    <SafeAreaView>
      <Button title="Toggle Freeze" onPress={handlePress} />
      <Text>{JSON.stringify(lastLayout)}</Text>
      <Freeze freeze={freeze}>
        <ScrollView>
          <Text onLayout={handleLayout}>hello</Text>
        </ScrollView>
      </Freeze>
    </SafeAreaView>
  );
}
