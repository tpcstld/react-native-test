/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import {FlashList} from '@shopify/flash-list';
import React from 'react';
import {View, Text, StyleSheet} from 'react-native';

const HEIGHT = 40;
const DATA = Array.from({length: 300}, (_, i) => i);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'green',
  },
  row: {
    height: HEIGHT,
    color: 'black',
  },
});

function renderItem({item}: {item: number}) {
  return <Text style={styles.row}>{item}</Text>;
}

export default function App(): JSX.Element {
  return (
    <View style={styles.container}>
      <FlashList
        data={DATA}
        renderItem={renderItem}
        estimatedItemSize={HEIGHT}
      />
    </View>
  );
}
