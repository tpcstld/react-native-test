/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import {FlashList} from '@shopify/flash-list';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import FastList from './FastList';

const NUM_ITEMS = 300;
const HEIGHT = 40;
const DATA = Array.from({length: NUM_ITEMS}, (_, i) => i);

const isFabricEnabled = global?.nativeFabricUIManager != null;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isFabricEnabled ? 'lightblue' : 'lightgreen',
  },
  row: {
    height: HEIGHT,
    color: 'black',
    backgroundColor: 'red',
  },
});

let startPoint = 0;

function Item({item}: {item: number}) {
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
  }, []);

  // if (mounted.current) {
  //   console.log(
  //     'htht - render',
  //     `index:${item}`,
  //     `ts:${performance.now() - startPoint}`,
  //   );
  // } else {
  //   console.log(
  //     'htht - mount',
  //     `index:${item}`,
  //     `ts:${performance.now() - startPoint}`,
  //   );
  // }

  return <Text style={styles.row}>{item}</Text>;
}

function renderItem({item}: {item: number}) {
  return <Item item={item} />;
}

function renderFastItem(section: number, item: number) {
  return <Item item={item} />;
}

let numScrollEvents = 0;

export default function App(): JSX.Element {
  const handleScroll = React.useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const data = performance.now();

      if (data - startPoint > 5000) {
        startPoint = data;
        numScrollEvents = 0;
        console.log('htht - starting', `isFabric:${isFabricEnabled}`);
      }

      console.log(
        'htht - scroll',
        `num:${numScrollEvents}`,
        `ts:${data - startPoint}`,
        `y:${e.nativeEvent.contentOffset.y}`,
      );
      numScrollEvents++;
    },
    [],
  );

  const handleBlank = React.useCallback(() => {
    console.log('htht - blank', performance.now() - startPoint);
  }, []);

  return (
    <View style={styles.container}>
      <FastList
        onScroll={handleScroll}
        renderItem={renderFastItem}
        itemSize={HEIGHT}
        sections={[NUM_ITEMS]}
      />
    </View>
  );
}

// <FlashList
//   onScroll={handleScroll}
//   onBlankArea={handleBlank}
//   data={DATA}
//   renderItem={renderItem}
//   estimatedItemSize={HEIGHT}
// />
