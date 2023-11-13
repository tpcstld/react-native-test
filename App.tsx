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

const HEIGHT = 40;
const DATA = Array.from({length: 300}, (_, i) => i);

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

  if (mounted.current) {
    console.log('htht - render', item, performance.now() - startPoint);
  } else {
    console.log('htht - mount ', item, performance.now() - startPoint);
  }

  return <Text style={styles.row}>{item}</Text>;
}

function renderItem({item}: {item: number}) {
  return <Item item={item} />;
}

export default function App(): JSX.Element {
  const handleScroll = React.useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const data = performance.now();

      if (data - startPoint > 5000) {
        startPoint = data;
        console.log('htht - starting', isFabricEnabled, data);
      }

      console.log(
        'htht - scroll',
        e.nativeEvent.velocity.y,
        e.nativeEvent.contentOffset.y,
        data - startPoint,
      );
    },
    [],
  );

  const handleBlank = React.useCallback(() => {
    console.log('htht - blank', performance.now() - startPoint);
  }, []);

  return (
    <View style={styles.container}>
      <FlashList
        onScroll={handleScroll}
        onBlankArea={handleBlank}
        data={DATA}
        renderItem={renderItem}
        estimatedItemSize={HEIGHT}
      />
    </View>
  );
}
