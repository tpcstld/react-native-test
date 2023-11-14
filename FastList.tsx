import * as React from 'react';
import {
  Animated,
  View,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollViewProps,
  PointProp,
  ScrollView,
} from 'react-native';
import lodash from 'lodash';

function isAndroid() {
  return true;
}

function shallowEqual(
  a: Record<string, any>,
  b: Record<string, any>,
  ignore?: string[],
): boolean {
  if (a === b) {
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (a[key] !== b[key] && (ignore == null || !ignore.includes(key))) {
      return false;
    }
  }

  return true;
}

const BATCH_DIVISOR = 4;
const DEFAULT_BATCHES_TO_RENDER = BATCH_DIVISOR * 3;
const MINIMUM_BATCHES_TO_RENDER = (BATCH_DIVISOR * 1.5) >> 0;
const SCROLL_TO_BOTTOM_PADDING = 16;
const AVERAGE_SPEED_SAMPLE = 10;
const DEFAULT_INSET = {top: 0, right: 0, left: 0, bottom: 0};

export enum FastListItemTypes {
  SPACER = 'SPACER',
  HEADER = 'HEADER',
  FOOTER = 'FOOTER',
  SECTION = 'SECTION',
  ITEM = 'ITEM',
  SECTION_FOOTER = 'SECTION_FOOTER',
}

function renderDefaultEmpty() {
  return null;
}

type HeaderSize = number | (() => number) | undefined;
type FooterSize = number | (() => number) | undefined;
type SectionSize = number | ((section: number) => number) | undefined;
type ItemSize = number | ((section: number, item?: number) => number);
type SectionFooterSize = number | ((section: number) => number) | undefined;

interface HeaderData {
  type: FastListItemTypes.HEADER;
  layoutStart: number;
  layoutSize: number;
}

interface SectionData {
  type: FastListItemTypes.SECTION;
  layoutStart: number;
  layoutSize: number;
  section: number;
}

interface UniformItemData {
  type: FastListItemTypes.ITEM;
  uniform: true;
  layoutStart: number;
  itemSize: number;
  layoutSize: number;
  section: number;
  items: number;
  sectionData: SectionData;
}

interface ItemData {
  type: FastListItemTypes.ITEM;
  uniform?: undefined;
  layoutStart: number;
  layoutSize: number;
  section: number;
  item: number;
  sectionData: SectionData;
}

interface SectionFooterData {
  type: FastListItemTypes.SECTION_FOOTER;
  layoutStart: number;
  layoutSize: number;
  section: number;
  sectionData: SectionData;
}

interface FooterData {
  type: FastListItemTypes.FOOTER;
  layoutStart: number;
  layoutSize: number;
}

type ComputedData =
  | HeaderData
  | SectionData
  | UniformItemData
  | ItemData
  | SectionFooterData
  | FooterData;

interface Chunk {
  start: number;
  end: number;
  data: ComputedData[];
}

export interface FastListItem {
  type: FastListItemTypes;
  key: number;
  layoutStart: number;
  layoutSize: number;
  section: number;
  item: number;
}

/**
 * FastListItemRecycler is used to recycle FastListItem objects between recomputations
 * of the list. By doing this we ensure that components maintain their keys and avoid
 * reallocations.
 */
class FastListItemRecycler {
  static _LAST_KEY: number = 0;

  _items: Partial<
    Record<FastListItemTypes, Partial<Record<string, FastListItem>>>
  > = {};
  _pendingItems: Partial<Record<FastListItemTypes, FastListItem[]>> = {};

  constructor(items: FastListItem[]) {
    items.forEach(fastListItem => {
      const {type, section, item} = fastListItem;
      const [items] = this._itemsForType(type);
      items[`${type}:${section}:${item}`] = fastListItem;
    });
  }

  _itemsForType(
    type: FastListItemTypes,
  ): [Partial<Record<string, FastListItem>>, FastListItem[]] {
    return [
      this._items[type] ?? (this._items[type] = {}),
      this._pendingItems[type] ?? (this._pendingItems[type] = []),
    ];
  }

  get(
    type: FastListItemTypes,
    layoutStart: number,
    layoutSize: number,
    section: number = 0,
    item: number = 0,
  ): FastListItem {
    const [items, pendingItems] = this._itemsForType(type);
    return this._get({
      type: type,
      layoutStart,
      layoutSize,
      section,
      item,
      items: items,
      pendingItems: pendingItems,
    });
  }

  _get({
    type,
    layoutStart,
    layoutSize,
    section,
    item,
    items,
    pendingItems,
  }: {
    type: FastListItemTypes;
    layoutStart: number;
    layoutSize: number;
    section: number;
    item: number;
    items: Partial<Record<string, FastListItem>>;
    pendingItems: FastListItem[];
  }) {
    const itemKey = `${type}:${section}:${item}`;
    let _item = items[itemKey];
    if (_item == null) {
      _item = {type, key: -1, layoutStart, layoutSize, section, item};
      pendingItems.push(_item);
    } else {
      _item = {..._item};
      _item.layoutStart = layoutStart;
      _item.layoutSize = layoutSize;
      delete items[itemKey];
    }
    return _item;
  }

  fill() {
    lodash.forEach(FastListItemTypes, type => {
      const [items, pendingItems] = this._itemsForType(type);
      this._fill(items, pendingItems);
    });
  }

  _fill(
    items: Partial<Record<string, FastListItem>>,
    pendingItems: FastListItem[],
  ) {
    let index = 0;

    lodash.forEach(items, item => {
      // HACK: `items` is a partial record, so `forEach()` thinks an individual item may be undefined.
      // The proper solve is enabling `noUncheckedIndexedAccess` in our tsconfig, but that's a massive change.
      const {key} = item!;

      const pendingItem = pendingItems[index];
      if (pendingItem == null) {
        return false;
      }
      pendingItem.key = key;
      index++;
    });

    for (; index < pendingItems.length; index++) {
      pendingItems[index].key = ++FastListItemRecycler._LAST_KEY;
    }

    pendingItems.length = 0;
  }
}

interface GetChunkIndexFromSectionItem {
  chunk: Chunk;
  targetSection: number;
  targetItem?: number;
  padBottom?: number;
}

interface FastListComputerProps {
  headerSize: HeaderSize;
  footerSize: FooterSize;
  sectionSize: SectionSize;
  itemSize: ItemSize;
  sectionFooterSize: SectionFooterSize;
  sections: number[];
  insetStart: number | undefined;
  insetEnd: number | undefined;
  stickyHeaderFooter: boolean;
}

export class FastListComputer {
  chunkSize: number = 0;
  private uniform: boolean = false;
  private dataCache: Chunk[] = [];
  private size: number = 0;
  private dirty: boolean = true;
  private props: FastListComputerProps;
  private chunkCache: Chunk | undefined;
  private lastStartChunk: number = -1;
  private lastEndChunk: number = -1;
  private items: FastListItem[] = [];

  constructor(props: FastListComputerProps) {
    this.props = props;
    this.updateProps(props);
  }

  updateProps(props: FastListComputerProps) {
    this.dirty = !this.dirty ? !shallowEqual(props, this.props) : true;
    this.props = props;
    this.uniform = typeof props.itemSize === 'number';
  }

  setInfo(scrollViewSize: number) {
    const chunkSize = Math.ceil(scrollViewSize / BATCH_DIVISOR);
    this.dirty = !this.dirty ? chunkSize !== this.chunkSize : true;
    this.chunkSize = chunkSize;
  }

  getSizeForHeader(): number {
    const {headerSize = 0} = this.props;
    return typeof headerSize === 'number' ? headerSize : headerSize();
  }

  getSizeForFooter(): number {
    const {footerSize = 0} = this.props;
    return typeof footerSize === 'number' ? footerSize : footerSize();
  }

  getSizeForSection(section: number): number {
    const {sectionSize = 0} = this.props;
    return typeof sectionSize === 'number' ? sectionSize : sectionSize(section);
  }

  getSizeForItem(section: number, item?: number): number {
    const {itemSize} = this.props;
    return typeof itemSize === 'number' ? itemSize : itemSize(section, item);
  }

  getSizeForSectionFooter(section: number): number {
    const {sectionFooterSize = 0} = this.props;
    return typeof sectionFooterSize === 'number'
      ? sectionFooterSize
      : sectionFooterSize(section);
  }

  getChunk(index: number): Chunk | undefined {
    const {dataCache} = this;
    let min = 0;
    let max = dataCache.length - 1;
    // chunkCache is a small optimization in that -- often loops will rely on
    // the previously used chunk, so by caching it and checking whether we can
    // re-use the last chunk, we can vastly speed things up from an access
    // perspective
    if (
      this.chunkCache != null &&
      index >= this.chunkCache.start &&
      index <= this.chunkCache.end
    ) {
      return this.chunkCache;
    }

    // Performs a binary search in an attempt to find the relevant chunk
    while (min <= max) {
      const half = min + (((max - min) / 2) | 0);
      const chunk = dataCache[half];
      if (chunk == null) {
        break;
      }
      if (index >= chunk.start && index <= chunk.end) {
        this.chunkCache = chunk;
        return chunk;
      }
      if (index < chunk.start) {
        max = half - 1;
      } else if (index > chunk.end) {
        min = half + 1;
      } else {
        break;
      }
    }
  }

  compute(
    start: number,
    end: number,
    prevItems: FastListItem[],
    exact = false,
  ): {size: number; items: FastListItem[]} {
    if (this.dirty) {
      this.fullCompute();
    } else if (start === this.lastStartChunk && end === this.lastEndChunk) {
      return {size: this.size, items: this.items};
    }
    const {stickyHeaderFooter} = this.props;
    this.lastStartChunk = start;
    this.lastEndChunk = end;

    const chunkStart = Math.floor(start / this.chunkSize);
    const chunkEnd = Math.max(Math.floor(end / this.chunkSize), chunkStart);
    let currentPos = chunkStart * this.chunkSize;
    const items: FastListItem[] = (this.items = []);
    const recycler = new FastListItemRecycler(prevItems);

    let sectionSpacerKey = 0;
    function addInitialSection(
      section: number,
      layoutStart: number,
      layoutSize: number,
      nextLayoutStart: number,
    ) {
      items.push(
        recycler.get(
          FastListItemTypes.SECTION,
          layoutStart,
          layoutSize,
          section,
        ),
      );
      const sectionEnd = layoutStart + layoutSize;
      if (sectionEnd < nextLayoutStart) {
        sectionSpacerKey++;
        items.push(
          recycler.get(
            FastListItemTypes.SPACER,
            sectionEnd,
            nextLayoutStart - sectionEnd,
            0,
            sectionSpacerKey,
          ),
        );
      }
    }

    function isVisible(itemTop: number, itemHeight: number): boolean {
      return !exact || (itemTop >= start - itemHeight && itemTop < end);
    }

    const chunks: Set<Chunk> = new Set();
    for (let i = chunkStart; i <= chunkEnd; i++) {
      const chunk = this.getChunk(i);
      chunk != null && chunks.add(chunk);
    }

    // Determine which things things are renderable and in view.  There are two
    // basic heuristics here, depending on whether `exact` is true or not.  The
    // default heuristic (`exact == false`) is to render all things inside the
    // `visible` chunks.  This default heuristic is used more generally while
    // scrolling around the list view because it provides a built in throttle
    // and renders data incrementally.  The `exact` heuristic is generally only
    // used on mount, which is used to only render the EXACT items that are
    // visible.  This ignores the chunk boundaries and calculates a pixel
    // perfect check on whether to render things or not.  This heuristic is not
    // ideal for scrolling behavior because it will result in blanking as you
    // scroll into regions that haven't been rendered.
    for (const chunk of Array.from(chunks)) {
      if (chunk == null) {
        continue;
      }
      for (const item of chunk.data) {
        if (item.layoutStart + item.layoutSize < currentPos) {
          // Item is not visible in a chunk
          continue;
        }
        switch (item.type) {
          case FastListItemTypes.HEADER:
            if (isVisible(item.layoutStart, item.layoutSize)) {
              items.push(
                recycler.get(
                  FastListItemTypes.HEADER,
                  item.layoutStart,
                  item.layoutSize,
                ),
              );
            }
            currentPos = item.layoutStart + item.layoutSize;
            break;
          case FastListItemTypes.SECTION:
            if (isVisible(item.layoutStart, item.layoutSize)) {
              items.push(
                recycler.get(
                  FastListItemTypes.SECTION,
                  item.layoutStart,
                  item.layoutSize,
                  item.section,
                ),
              );
            }
            currentPos = item.layoutStart + item.layoutSize;
            break;
          case FastListItemTypes.ITEM: {
            if (item.uniform == null) {
              if (isVisible(item.layoutStart, item.layoutSize)) {
                if (items.length === 0) {
                  addInitialSection(
                    item.section,
                    item.sectionData.layoutStart,
                    item.sectionData.layoutSize,
                    item.layoutStart,
                  );
                }
                items.push(
                  recycler.get(
                    FastListItemTypes.ITEM,
                    item.layoutStart,
                    item.layoutSize,
                    item.section,
                    item.item,
                  ),
                );
              }
              currentPos = item.layoutStart + item.layoutSize;
            } else {
              let currentItem =
                currentPos > item.layoutStart
                  ? Math.floor((currentPos - item.layoutStart) / item.itemSize)
                  : 0;
              currentPos = item.layoutStart + item.itemSize * currentItem;
              while (
                currentPos < chunkEnd * this.chunkSize &&
                currentItem < item.items
              ) {
                if (isVisible(currentPos, item.itemSize)) {
                  if (items.length === 0) {
                    addInitialSection(
                      item.section,
                      item.sectionData.layoutStart,
                      item.sectionData.layoutSize,
                      currentPos,
                    );
                  }
                  items.push(
                    recycler.get(
                      FastListItemTypes.ITEM,
                      currentPos,
                      item.itemSize,
                      item.section,
                      currentItem,
                    ),
                  );
                }
                currentPos += item.itemSize;
                currentItem++;
              }
            }
            break;
          }
          case FastListItemTypes.SECTION_FOOTER:
            if (isVisible(item.layoutStart, item.layoutSize)) {
              if (items.length === 0) {
                addInitialSection(
                  item.section,
                  item.sectionData.layoutStart,
                  item.sectionData.layoutSize,
                  item.layoutStart,
                );
              }
              items.push(
                recycler.get(
                  FastListItemTypes.SECTION_FOOTER,
                  item.layoutStart,
                  item.layoutSize,
                  item.section,
                ),
              );
            }
            currentPos = item.layoutStart + item.layoutSize;
            break;
          case FastListItemTypes.FOOTER:
            if (isVisible(item.layoutStart, item.layoutSize)) {
              items.push(
                recycler.get(
                  FastListItemTypes.FOOTER,
                  item.layoutStart,
                  item.layoutSize,
                ),
              );
            }
            currentPos = item.layoutStart + item.layoutSize;
            break;
        }
      }
    }

    // Now that we've determined which items are in view, we may need to
    // compute a spacer(s) item before the content (i.e. to push the content
    // down to where it's supposed to display at).  If we have
    // `stickyHeaderFooter` enabled this becomes a bit more complicated because
    // we will ALWAYS render the header and that might involve some additional
    // spacers before and after the header component itself, so it's positioned
    // properly in the list view.
    const firstItem = items[0];
    if (firstItem != null && firstItem.layoutStart > 0) {
      const headerItem: ComputedData | undefined = this.dataCache[0]?.data[0];
      let {layoutStart: firstItemLayoutStart} = firstItem;
      if (
        stickyHeaderFooter &&
        headerItem != null &&
        firstItem.type !== 'HEADER'
      ) {
        // If there's a spacer required between the header and initial item, inect it now
        if (
          firstItemLayoutStart -
            headerItem.layoutStart -
            headerItem.layoutSize >
          0
        ) {
          items.unshift(
            recycler.get(
              FastListItemTypes.SPACER,
              headerItem.layoutStart + headerItem.layoutSize,
              firstItemLayoutStart -
                headerItem.layoutStart -
                headerItem.layoutSize,
              0,
              0,
            ),
          );
        }
        items.unshift(
          recycler.get(
            FastListItemTypes.HEADER,
            headerItem.layoutStart,
            headerItem.layoutSize,
          ),
        );
        firstItemLayoutStart = headerItem.layoutStart;
      }
      if (firstItemLayoutStart > 0) {
        items.unshift(
          recycler.get(FastListItemTypes.SPACER, 0, firstItemLayoutStart, 0, 1),
        );
      }
    }

    // Finally we may need to compute a spacer(s) after the content that
    // ensures the scroll view is always as tall as the computed scrollable
    // region region.  This is made a bit more complicated if
    // `stickyHeaderFooter` is enabled because we may have to buttress some
    // spacers before and after the rendered footer component.
    const finalItem = items[items.length - 1];
    let spacerStart =
      finalItem != null
        ? finalItem.layoutStart + finalItem.layoutSize
        : this.size;
    if (spacerStart < this.size) {
      const lastChunkData = this.dataCache[this.dataCache.length - 1]?.data;
      const footerItem: ComputedData | undefined =
        lastChunkData?.[lastChunkData.length - 1];
      if (
        stickyHeaderFooter &&
        footerItem != null &&
        finalItem.type !== 'FOOTER'
      ) {
        // If there's a spacer required between the footer and last item item, inect it now
        if (spacerStart < footerItem.layoutStart) {
          items.push(
            recycler.get(
              FastListItemTypes.SPACER,
              spacerStart,
              footerItem.layoutStart + footerItem.layoutSize - spacerStart,
              1,
              0,
            ),
          );
        }
        items.push(
          recycler.get(
            FastListItemTypes.FOOTER,
            footerItem.layoutStart,
            footerItem.layoutSize,
          ),
        );
        spacerStart = footerItem.layoutStart + footerItem.layoutSize;
      }
      if (spacerStart < this.size) {
        items.push(
          recycler.get(
            FastListItemTypes.SPACER,
            spacerStart,
            this.size - spacerStart,
            1,
            1,
          ),
        );
      }
    }

    recycler.fill();
    return {size: this.size, items};
  }

  fullCompute() {
    const {sections, insetStart = 0, insetEnd = 0} = this.props;
    const dataCache: Chunk[] = (this.dataCache = []);
    this.chunkCache = undefined;
    const {chunkSize} = this;
    let size = insetStart;

    const pushData = (start: number, end: number, data: ComputedData) => {
      size += end - start;
      const startChunkIndex = Math.max(Math.floor(start / chunkSize), 0);
      const endChunkIndex = Math.max(
        Math.floor(end / chunkSize) - 1,
        startChunkIndex,
      );
      let chunk = this.getChunk(startChunkIndex);
      if (chunk == null) {
        chunk = {
          start: startChunkIndex,
          end: endChunkIndex,
          data: [],
        };
        dataCache.push(chunk);
      }
      chunk.end = endChunkIndex;
      chunk.data.push(data);
    };

    let layoutStart;

    const headerSize = this.getSizeForHeader();
    if (headerSize > 0) {
      layoutStart = size;
      pushData(layoutStart, layoutStart + headerSize, {
        type: FastListItemTypes.HEADER,
        layoutStart,
        layoutSize: headerSize,
      });
    }

    for (let section = 0; section < sections.length; section++) {
      const items = sections[section];

      if (items === 0) {
        continue;
      }

      layoutStart = size;

      const sectionSize = this.getSizeForSection(section);
      const sectionData: ComputedData = {
        type: FastListItemTypes.SECTION,
        layoutStart,
        layoutSize: sectionSize,
        section,
      };
      pushData(layoutStart, layoutStart + sectionSize, sectionData);

      if (this.uniform) {
        const itemSize = this.getSizeForItem(section);
        layoutStart = size;
        pushData(layoutStart, layoutStart + itemSize * items, {
          type: FastListItemTypes.ITEM,
          uniform: true,
          layoutStart,
          itemSize: itemSize,
          layoutSize: itemSize * items,
          section,
          items,
          sectionData,
        });
      } else {
        for (let item = 0; item < items; item++) {
          const itemSize = this.getSizeForItem(section, item);
          layoutStart = size;
          pushData(layoutStart, layoutStart + itemSize, {
            type: FastListItemTypes.ITEM,
            layoutStart,
            layoutSize: itemSize,
            section,
            item,
            sectionData,
          });
        }
      }

      const sectionFooterSize = this.getSizeForSectionFooter(section);
      if (sectionFooterSize > 0) {
        layoutStart = size;
        pushData(layoutStart, layoutStart + sectionFooterSize, {
          type: FastListItemTypes.SECTION_FOOTER,
          layoutStart,
          layoutSize: sectionFooterSize,
          section,
          sectionData,
        });
      }
    }

    const footerSize = this.getSizeForFooter();
    if (footerSize > 0) {
      layoutStart = size;
      pushData(layoutStart, layoutStart + footerSize, {
        type: FastListItemTypes.FOOTER,
        layoutStart,
        layoutSize: footerSize,
      });
    }

    size += insetEnd;
    this.size = size;
    this.dirty = false;
  }

  getChunkDataFromSectionItem(
    targetSection: number,
    targetItem?: number,
  ): Chunk | undefined {
    if (this.dirty) {
      this.fullCompute();
    }
    const {dataCache} = this;
    for (const chunk of dataCache) {
      for (const data of chunk.data) {
        switch (data.type) {
          case FastListItemTypes.ITEM:
            if (targetItem == null) {
              break;
            }
            if (data.uniform === true && data.section === targetSection) {
              if (targetItem > data.items) {
                return undefined;
              }
              return chunk;
            } else if (
              data.uniform == null &&
              data.section === targetSection &&
              data.item === targetItem
            ) {
              return chunk;
            }
            break;
          case FastListItemTypes.SECTION:
            if (data.section > targetSection) {
              return undefined;
            }
            if (targetItem != null) {
              continue;
            }
            return chunk;
        }
      }
    }
  }

  getChunkIndexFromSectionItem({
    chunk,
    targetSection,
    targetItem,
    padBottom = SCROLL_TO_BOTTOM_PADDING,
  }: GetChunkIndexFromSectionItem):
    | {startIndex: number; endIndex: number}
    | undefined {
    for (const item of chunk.data) {
      switch (item.type) {
        case FastListItemTypes.ITEM:
          if (item.section !== targetSection) {
            continue;
          }
          if (targetItem == null) {
            continue;
          }
          if (item.uniform) {
            if (targetItem >= item.items) {
              return undefined;
            }
            const startingPosition =
              item.layoutStart +
              item.sectionData.layoutSize +
              item.itemSize * targetItem;
            return {
              startIndex: Math.floor(startingPosition / this.chunkSize),
              endIndex: Math.floor(
                (startingPosition + item.itemSize + padBottom) / this.chunkSize,
              ),
            };
          } else {
            if (item.item >= targetItem) {
              return undefined;
            }
            if (item.item !== targetItem) {
              continue;
            }
            return {
              startIndex: Math.floor(
                (item.layoutStart - item.sectionData.layoutSize) /
                  this.chunkSize,
              ),
              endIndex: Math.floor(
                (item.layoutStart + item.layoutSize + padBottom) /
                  this.chunkSize,
              ),
            };
          }
        case FastListItemTypes.SECTION:
          if (targetItem != null) {
            continue;
          }
          if (targetSection < item.section) {
            return undefined;
          }
          if (targetSection === item.section) {
            return {
              startIndex: Math.floor(item.layoutStart / this.chunkSize),
              endIndex: Math.floor(
                (item.layoutStart + item.layoutSize + padBottom) /
                  this.chunkSize,
              ),
            };
          }
      }
    }
    return undefined;
  }

  computeScrollPosition(
    targetSection: number,
    targetItem?: number,
  ): {scrollPosition: number; size: number; sectionOffset: number} | undefined {
    // negative values as a target are illegal, and therefore we shouldn't
    // attempt to compute it
    if (targetItem != null && targetItem < 0) {
      return undefined;
    }
    if (this.dirty) {
      this.fullCompute();
    }
    const {dataCache} = this;
    if (targetSection < 0) {
      return {
        scrollPosition: 0,
        size: 0,
        sectionOffset: 0,
      };
    }
    for (const chunk of dataCache) {
      for (const data of chunk.data) {
        switch (data.type) {
          case FastListItemTypes.ITEM:
            if (targetItem == null) {
              break;
            }
            if (data.uniform === true && data.section === targetSection) {
              if (targetItem > data.items) {
                return undefined;
              }
              return {
                scrollPosition:
                  data.sectionData.layoutStart +
                  data.sectionData.layoutSize +
                  data.itemSize * targetItem,
                size: data.itemSize,
                sectionOffset: data.sectionData.layoutSize,
              };
            } else if (
              data.uniform == null &&
              data.section === targetSection &&
              data.item === targetItem
            ) {
              return {
                scrollPosition: data.layoutStart,
                size: data.layoutSize,
                sectionOffset: data.sectionData.layoutSize,
              };
            }
            break;
          case FastListItemTypes.SECTION:
            if (data.section > targetSection) {
              return undefined;
            }
            if (targetItem != null) {
              continue;
            }
            return {
              scrollPosition: data.layoutStart,
              size: data.layoutSize,
              sectionOffset: 0,
            };
        }
      }
    }
  }

  getSize(): number {
    if (this.dirty) {
      this.fullCompute();
    }
    return this.size;
  }

  isDirty() {
    return this.dirty;
  }
}

interface BaseFastListRenderProps {
  horizontal: boolean;
  disableWrapper: boolean;
  layoutSize: number;
  scrollManager: FastListScrollManager;
}

interface FastListSectionRendererProps extends BaseFastListRenderProps {
  layoutStart: number;
  nextSectionLayoutPosition?: number;
  scrollPosValue?: Animated.Value;
  section: number;
  children: (
    section: number,
    scrollManager: FastListScrollManager,
  ) => React.ReactElement | null | undefined;
}

function _FastListSectionRenderer({
  layoutStart,
  layoutSize,
  horizontal,
  nextSectionLayoutPosition,
  scrollPosValue,
  section,
  scrollManager,
  children,
}: FastListSectionRendererProps) {
  const inputRange: number[] = [-1, 0];
  const outputRange: number[] = [0, 0];

  inputRange.push(layoutStart);
  outputRange.push(0);
  const collisionPoint = (nextSectionLayoutPosition ?? 0) - layoutSize;
  if (collisionPoint >= layoutStart) {
    // Honestly I have no idea why this happens, but on Android, the translation sometimes
    // leaves a little 1px gap between the section view and the top of the scroll view.
    // We adapt to this by adjusting the output range by 1
    const mobileEndAdjustment = isAndroid() ? -1 : 0;

    inputRange.push(collisionPoint, collisionPoint + 1);
    outputRange.push(
      collisionPoint - layoutStart + mobileEndAdjustment,
      collisionPoint - layoutStart + mobileEndAdjustment,
    );
  } else {
    inputRange.push(layoutStart + 1);
    outputRange.push(1);
  }

  const interpolatedValue = scrollPosValue?.interpolate({
    inputRange,
    outputRange,
  });

  const child = React.Children.only(children(section, scrollManager));

  return (
    <Animated.View
      style={[
        child?.props?.style,
        {
          zIndex: 10,
          height: !horizontal ? layoutSize : undefined,
          width: horizontal ? layoutSize : undefined,
          transform:
            interpolatedValue != null
              ? [
                  horizontal
                    ? {translateX: interpolatedValue}
                    : {translateY: interpolatedValue},
                ]
              : undefined,
        },
      ]}
      // @ts-expect-error
      preventClipping>
      {child != null
        ? React.cloneElement(child!, {
            style: {flex: 1},
          })
        : undefined}
    </Animated.View>
  );
}

const FastListSectionRenderer = React.memo(_FastListSectionRenderer);

interface FastListSectionFooterRenderProps extends BaseFastListRenderProps {
  section: number;
  children: (
    section: number,
    scrollManager: FastListScrollManager,
  ) => React.ReactNode;
}

function _FastListSectionFooterRenderer({
  layoutSize,
  horizontal,
  disableWrapper,
  children,
  section,
  scrollManager,
}: FastListSectionFooterRenderProps) {
  return !disableWrapper ? (
    <View style={horizontal ? {width: layoutSize} : {height: layoutSize}}>
      {children(section, scrollManager)}
    </View>
  ) : (
    <>{children(section, scrollManager)}</>
  );
}

const FastListSectionFooterRenderer = React.memo(
  _FastListSectionFooterRenderer,
);

interface FastListItemRenderProps extends BaseFastListRenderProps {
  section: number;
  item: number;
  children?: (
    section: number,
    item: number,
    scrollManager: FastListScrollManager,
  ) => React.ReactNode;
}

function _FastListItemRenderer({
  layoutSize,
  horizontal,
  disableWrapper,
  children,
  section,
  item,
  scrollManager,
}: FastListItemRenderProps) {
  return !disableWrapper ? (
    <View style={horizontal ? {width: layoutSize} : {height: layoutSize}}>
      {children?.(section, item, scrollManager)}
    </View>
  ) : (
    <>{children?.(section, item, scrollManager)}</>
  );
}

const FastListItemRenderer = React.memo(_FastListItemRenderer);

interface FastListHeaderRendererProps {
  horizontal: boolean;
  disableWrapper: boolean;
  layoutSize: number;
  scrollManager: FastListScrollManager;
  children: (scrollManager: FastListScrollManager) => React.ReactNode;
}

function _FastListHeaderFooterRenderer({
  layoutSize,
  horizontal,
  disableWrapper,
  children,
  scrollManager,
}: FastListHeaderRendererProps) {
  return !disableWrapper ? (
    <View style={horizontal ? {width: layoutSize} : {height: layoutSize}}>
      {children(scrollManager)}
    </View>
  ) : (
    <>{children(scrollManager)}</>
  );
}

const FastListHeaderFooterRenderer = React.memo(_FastListHeaderFooterRenderer);

interface FastListSpacerProps {
  horizontal: boolean;
  layoutSize: number;
}

function _FastListSpacer({layoutSize, horizontal}: FastListSpacerProps) {
  return (
    <View style={horizontal ? {width: layoutSize} : {height: layoutSize}} />
  );
}

const FastListSpacer = React.memo(_FastListSpacer);

type GetIdFromIndex = (section: number, item?: number) => string | undefined;
type GetIndexFromId = (
  id: string,
) => {section: number; item?: number} | undefined;

export interface FastListProps extends Omit<ScrollViewProps, 'onLayout'> {
  manualRef?: React.RefObject<ScrollView>;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollEnd?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout?: (event: LayoutChangeEvent, instance: FastList) => void;
  renderHeader?: (
    scrollManager: FastListScrollManager,
  ) => React.ReactNode | null | undefined;
  renderFooter?: (
    scrollManager: FastListScrollManager,
  ) => React.ReactNode | null | undefined;
  renderSection?: (
    section: number,
    scrollManager: FastListScrollManager,
  ) => React.ReactElement | null | undefined;
  renderItem: (
    section: number,
    item: number,
    scrollManager: FastListScrollManager,
  ) => React.ReactNode | null | undefined;
  renderSectionFooter?: (
    section: number,
    scrollManager: FastListScrollManager,
  ) => React.ReactNode | null | undefined;
  renderAccessory?: (
    list: FastList,
    scrollManager: FastListScrollManager,
  ) => React.ReactNode;
  renderEmpty?: () => React.ReactNode | null | undefined;
  onEndReached?: (info: {distanceFromEnd: number}) => void;
  endReachedThreshold?: number;
  headerSize?: HeaderSize;
  footerSize?: FooterSize;
  sectionSize?: SectionSize;
  sectionFooterSize?: SectionFooterSize;
  itemSize: ItemSize;
  sections: number[];
  insetStart?: number;
  insetEnd?: number;
  scrollPosValue?: Animated.Value;
  minimumScrollVelocity?: number;

  // NOTE(amadeus): The size of the scrollable region is divided by 4 into
  // what we call `batches`. `batchesToRender` refers to how many of these
  // quarter unit batches worth of content should we render.  Typical use
  // should probably be a minimum of 8 (approximately 2 screens of content)
  // up to maybe around 12 (three screens of content).  As the user scrolls,
  // we adjust the content to render region using these batch units.
  batchesToRender?: number;

  // NOTE(amadeus): `optimizeListItemRender` is meant to be used as a
  // performance optimization for FastList on low-end mobile devices.
  // Essentially it helps to shortcut additional re-renders, usually while
  // scrolling or when the parent of FastList re-renders.  As an
  // optimization, it's not always safe to apply globally, and therefore it's
  // an opt-in prop.  The best use case for this optimization is for lists
  // that contain items that will not change once rendered or when render
  // functions are memoized based on the data they have to render from.
  optimizeListItemRender?: boolean;
  contentInset?: {
    top?: number;
    left?: number;
    right?: number;
    bottom?: number;
  };
  initialScrollSection?: number;
  initialScrollItem?: number;
  initialScrollOrientation?: ScrollToLocationOrientations;
  initialScrollStart?: number;
  getAnchorIdFromIndex?: GetIdFromIndex;
  getAnchorIndexFromId?: GetIndexFromId;
  // NOTE(amadeus): If you enable this prop it will cause whatever scrolling is
  // in progress to just stop when FastList is updated with new content.  It's
  // currently being improved to work seamlessly, but until then, only use it
  // in dev or staff based experiments

  EXPERIMENTAL_enableAnchorWhileScrolling?: boolean;
  chunkBase?: number;
  disableContentWrappers?: boolean;
  childrenWrapper?: (items: React.ReactNode) => React.ReactNode;
  stickyHeaderFooter?: boolean;
  disableStickySections?: boolean;
  inActionSheet?: boolean;
  onContentSizeChange?: ScrollViewProps['onContentSizeChange'];
  // Special initial scroll buffer used by our fork of the bottom-sheet library, which
  // prevents the view from fully expanding until the scroll offset has surpassed the buffer.
  scrollBuffer?: number;
  // Special property used by our fork of the bottom-sheet library, which causes scroll momentum to
  // be fully preserved when expanding the sheet via a scrollable component.
  preserveScrollMomentum?: boolean;
}

interface BlockState {
  batchSize: number;
  blockStart: number;
  blockEnd: number;
}

interface FastListState extends BlockState {
  fastListComputer: FastListComputer;
  isFirstLayout: boolean;
  size: number;
  items: FastListItem[];
  initialContentOffset: PointProp | undefined;
  hasReachedEndBefore: boolean;
}

function getBatchSize(containerSize: number): number {
  return Math.ceil(containerSize / BATCH_DIVISOR);
}

function computeBlock(
  containerSize: number,
  scrollPos: number,
  batches: number,
): BlockState {
  if (containerSize === 0) {
    return {
      batchSize: 0,
      blockStart: 0,
      blockEnd: 0,
    };
  }
  // NOTE(amadeus): Clean up floats
  containerSize = Math.ceil(containerSize);
  scrollPos = Math.floor(scrollPos);
  const batchSize = getBatchSize(containerSize);
  const renderSize = batchSize * batches;
  const initialBlockNumber = Math.max(
    0,
    Math.round((scrollPos + containerSize / 2) / batchSize) - batches / 2,
  );
  const blockStart = initialBlockNumber * batchSize;
  const blockEnd = blockStart + renderSize;

  return {
    batchSize,
    blockStart,
    blockEnd,
  };
}

type ScrollSpeedChangeHandler = (isScrolling: boolean) => unknown | true;

export class FastListScrollManager {
  private subscribers = new Set<ScrollSpeedChangeHandler>();
  private scrollPos = 0;
  private scrollSpeed: number[] = [];
  private averageSpeed: number = 0;
  private minimumVelocity: number;
  private scrolling = false;
  private lastTick: number | null = null;
  containerSize: number = 0;

  constructor(minimumVelocity: number) {
    this.minimumVelocity = minimumVelocity;
  }

  private detectIfScrolling() {
    return this.averageSpeed > this.minimumVelocity;
  }

  isScrolling() {
    return this.scrolling;
  }

  subscribe(callback: ScrollSpeedChangeHandler) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  unsubscribe(callback: ScrollSpeedChangeHandler) {
    this.subscribers.delete(callback);
  }

  setScrollSpeed(scrollPos: number) {
    const {scrollPos: lastScrollPos} = this;
    this.scrollPos = scrollPos;
    // NOOP if there are no subscribers to inform -- it's work we dont' need to
    // be doing
    if (this.subscribers.size === 0) {
      return;
    }
    if (this.lastTick == null) {
      this.lastTick = Date.now();
      return;
    }
    const now = Date.now();
    const delta = (now - this.lastTick) / 1000; // Time in seconds
    this.lastTick = now;
    this.scrollSpeed.unshift(
      Math.floor(Math.abs(scrollPos - lastScrollPos)) / delta,
    ); // pixels per second
    if (this.scrollSpeed.length > AVERAGE_SPEED_SAMPLE) {
      this.scrollSpeed.length = AVERAGE_SPEED_SAMPLE;
    }
    this.averageSpeed =
      this.scrollSpeed.reduce((prev, current) => prev + current, 0) /
      this.scrollSpeed.length;
    this.debouncedScrollComplete(300);
    if (this.detectIfScrolling() === this.scrolling) {
      return;
    }
    this.scrolling = this.detectIfScrolling();
    this.notifySubscribers();
  }

  notifySubscribers() {
    for (const subscriber of this.subscribers) {
      const remove = subscriber(this.scrolling);
      if (remove === true) {
        this.subscribers.delete(subscriber);
      }
    }
  }

  _timeout = -1;

  debouncedScrollComplete(timeout = 1) {
    if (this.subscribers.size === 0) {
      return;
    }
    clearTimeout(this._timeout);
    this._timeout = setTimeout(this.scrollComplete, timeout);
  }

  scrollComplete = () => {
    this.lastTick = null;
    this.scrollSpeed.length = 0;
    if (this.scrolling === false) {
      return;
    }
    this.scrolling = false;
    this.notifySubscribers();
  };

  getScrollSpecs() {
    return {scrollPosition: this.scrollPos, containerSize: this.containerSize};
  }
}

class FastListScrollAnchor {
  private isCustomAnchor: boolean = false;
  private anchorId: string | undefined;
  anchorOffset: number | undefined;

  constructor(private getScrollPosition: () => number) {}

  hasAnchor(): boolean {
    return this.anchorId != null;
  }

  cleanAnchor(includeCustom: boolean = false) {
    if (!includeCustom && this.isCustomAnchor) {
      return;
    }
    this.isCustomAnchor = false;
    this.anchorId = undefined;
    this.anchorOffset = undefined;
  }

  handleUserScroll() {
    this.cleanAnchor(true);
  }

  // A custom anchor is specified manually and we often attempt to hold onto it
  // until the user manually scrolls
  setCustomAnchor(
    getIdFromIndex: GetIdFromIndex,
    anchorOffset: number,
    section: number,
    item?: number,
  ) {
    this.isCustomAnchor = true;
    this.anchorOffset = anchorOffset;
    this.anchorId = getIdFromIndex(section, item);
    // If we can't find a valid anchorId, we should clear out the anchor
    if (this.anchorId == null) {
      this.cleanAnchor(true);
    }
  }

  findOrUpdateAnchor(getIdFromIndex: GetIdFromIndex, items: FastListItem[]) {
    const scrollPosition = this.getScrollPosition();
    // Custom anchors shouldn't get cleared out until the user has performed an
    // intentional scroll
    this.cleanAnchor();
    for (const item of items) {
      // We only anchor `items` right now...
      if (item.type !== FastListItemTypes.ITEM) {
        continue;
      }
      // If we have set a custom anchor element, we will just try to get the
      // updated anchor offset for it
      if (
        this.isCustomAnchor &&
        this.anchorId === getIdFromIndex(item.section, item.item ?? 0)
      ) {
        this.anchorOffset = item.layoutStart - scrollPosition;
        return;
      }
      // Otherwise no custom anchor was specified, so find one from the available items
      else if (!this.isCustomAnchor && item.layoutStart >= scrollPosition) {
        this.anchorOffset = item.layoutStart - scrollPosition;
        this.anchorId = getIdFromIndex(item.section, item.item ?? 0);
        return;
      }
    }
  }

  getAnchorIndex(
    getIndexFromId: GetIndexFromId,
  ): {section: number; item?: number} | undefined {
    if (this.anchorId == null) {
      return undefined;
    }
    const anchorIndex = getIndexFromId(this.anchorId);
    this.cleanAnchor();
    return anchorIndex;
  }
}

export const FastListScrollManagerContext = React.createContext(
  new FastListScrollManager(0),
);

type ScrollToLocationOrientations = 'top' | 'visible' | 'center';

export interface ScrollToLocationProps {
  section: number;
  item: number;
  animated?: boolean;
  orientation?: ScrollToLocationOrientations;
  paddingStart?: number;
  paddingEnd?: number;
  setAnchor?: boolean;
}

type CalculateScrollPositionProps = Pick<
  ScrollToLocationProps,
  'orientation' | 'paddingStart' | 'paddingEnd'
> & {
  fullSize: number;
  itemCoords: NonNullable<
    ReturnType<FastListComputer['computeScrollPosition']>
  >;
};

export default class FastList extends React.PureComponent<
  FastListProps,
  FastListState,
  boolean
> {
  containerSize: number = 0;
  scrollPos: number = 0;
  scrollPosValue: Animated.Value =
    this.props.scrollPosValue ?? new Animated.Value(0);
  scrollPosValueAttachment: {detach: () => void} | undefined;
  scrollView =
    this.props.manualRef ??
    React.createRef<RNGHScrollView | BottomSheetScrollViewMethods>();
  renderUpdate: number = -1;
  scrollManager = new FastListScrollManager(
    Math.abs(this.props.minimumScrollVelocity ?? 0),
  );
  getItems = () => this.state.items;
  getScrollPosition = () => this.scrollPos;
  disableAnchoringTimeout: number | undefined = undefined;

  private deferredCompute: number = -1;
  private deferNextCompute: boolean = false;
  scrollAnchor = new FastListScrollAnchor(this.getScrollPosition);

  static getDerivedStateFromProps(props: FastListProps, state: FastListState) {
    const {fastListComputer} = state;
    fastListComputer.updateProps({
      headerSize: props.headerSize,
      footerSize: props.footerSize,
      sectionSize: props.sectionSize,
      itemSize: props.itemSize,
      sectionFooterSize: props.sectionFooterSize,
      sections: props.sections,
      insetStart: props.insetStart,
      insetEnd: props.insetEnd,
      stickyHeaderFooter: props.stickyHeaderFooter ?? false,
    });
    if (state.batchSize === 0) {
      return {
        ...state,
        size: (props.insetStart ?? 0) + (props.insetEnd ?? 0),
        items: [],
      };
    }
    if (fastListComputer.isDirty()) {
      return {
        ...state,
        ...fastListComputer.compute(
          state.blockStart,
          state.blockEnd,
          state.items ?? [],
        ),
      };
    }
    return null;
  }

  _scrollPositionToPoint = (scrollPosition: number): PointProp => {
    const {horizontal} = this.props;
    return {
      x: horizontal ? scrollPosition : 0,
      y: !horizontal ? scrollPosition : 0,
    };
  };

  _calculateScrollPosition = ({
    itemCoords,
    fullSize,
    orientation = 'top',
    paddingStart = 0,
    paddingEnd = 0,
  }: CalculateScrollPositionProps): number | null => {
    let {scrollPosition, size, sectionOffset} = itemCoords;

    const containerSize =
      this.containerSize > 0 ? this.containerSize : this.props.chunkBase ?? 0;
    const scrollableRange = fullSize - containerSize;
    // If our item is bigger then a full view, we default to top
    if (size >= containerSize) {
      orientation = 'top';
    }
    switch (orientation) {
      case 'visible':
        // The item is fully in view, therefore we have no need to scroll
        // anywhere
        if (
          scrollPosition + sectionOffset >= this.scrollPos + paddingStart &&
          scrollPosition + size <= this.scrollPos + (containerSize - paddingEnd)
        ) {
          return null;
        }
        // If the container is bigger than the screen, or the item is before
        // our current scroll position, lets scroll to the top of the item,
        // which means break out of this switch and let the scrollTo below
        // handle as is
        if (size > containerSize || scrollPosition < this.scrollPos) {
          scrollPosition -= sectionOffset + paddingStart;
          break;
        }
        // Otherwise, the element is below or bleeding out towards the bottom
        // of the scrollview, so get a scroll position the orients the item
        // into view
        scrollPosition = scrollPosition + size + paddingEnd - containerSize;
        break;
      case 'top':
        scrollPosition -= sectionOffset + paddingStart;
        break;
      case 'center':
        const itemMiddle =
          itemCoords.scrollPosition + Math.floor(itemCoords.size / 2);
        scrollPosition = itemMiddle - Math.floor(containerSize / 2);
        break;
    }
    return Math.min(scrollPosition, scrollableRange);
  };

  state: FastListState = (() => {
    const {
      chunkBase,
      headerSize,
      footerSize,
      sectionSize,
      itemSize,
      sectionFooterSize,
      sections,
      insetStart,
      insetEnd,
      stickyHeaderFooter = false,
    } = this.props;
    const fastListComputer = new FastListComputer({
      headerSize,
      footerSize,
      sectionSize,
      itemSize,
      sectionFooterSize,
      sections,
      insetStart,
      insetEnd,
      stickyHeaderFooter,
    });
    return this.getInitialState(chunkBase ?? 0, fastListComputer, true);
  })();

  // This method figures out what our initial batch of `items` should be based
  // on our initial scroll parameters
  getInitialState(
    containerSize: number,
    fastListComputer: FastListComputer,
    isFirstLayout: boolean,
    prevItems: FastListItem[] = [],
  ): FastListState {
    const {
      initialScrollSection = 0,
      initialScrollItem,
      initialScrollOrientation = 'visible',
      initialScrollStart,
    } = this.props;
    let batchSize = 0;
    fastListComputer.setInfo(containerSize);
    batchSize = getBatchSize(containerSize);
    let blockStart = initialScrollStart ?? 0;
    let blockEnd = blockStart + containerSize;
    let initialContentOffset;

    if (initialScrollStart != null) {
      initialContentOffset = this._scrollPositionToPoint(initialScrollStart);
    } else if (
      (initialScrollSection > 0 || initialScrollItem != null) &&
      containerSize > 0
    ) {
      const itemCoords = fastListComputer.computeScrollPosition(
        initialScrollSection,
        initialScrollItem,
      );
      if (itemCoords != null) {
        if (
          initialScrollOrientation === 'top' ||
          itemCoords.size >= containerSize
        ) {
          blockStart = itemCoords.scrollPosition - itemCoords.sectionOffset;
          blockEnd = blockStart + containerSize;
        } else {
          blockStart = Math.max(
            0,
            itemCoords.scrollPosition +
              itemCoords.size +
              SCROLL_TO_BOTTOM_PADDING -
              containerSize,
          );
          blockEnd = blockStart + containerSize;
        }
        const initialScrollPosition = this._calculateScrollPosition({
          itemCoords,
          fullSize: fastListComputer.getSize(),
          orientation: initialScrollOrientation,
          paddingEnd: SCROLL_TO_BOTTOM_PADDING,
        });
        if (initialScrollPosition != null) {
          initialContentOffset = this._scrollPositionToPoint(
            initialScrollPosition,
          );
        }
      }
    }
    return {
      ...(containerSize > 0
        ? fastListComputer.compute(blockStart, blockEnd, prevItems, true)
        : {size: 0, items: []}),
      batchSize,
      blockStart,
      blockEnd,
      isFirstLayout,
      fastListComputer,
      initialContentOffset,
      hasReachedEndBefore: false,
    };
  }

  constructor(props: FastListProps) {
    super(props);
    const {
      batchesToRender = DEFAULT_BATCHES_TO_RENDER,
      getAnchorIdFromIndex,
      getAnchorIndexFromId,
    } = this.props;
    if (batchesToRender < MINIMUM_BATCHES_TO_RENDER) {
      throw new Error(
        `FastList: batchesToRender must be >= ${(BATCH_DIVISOR * 1.5) >> 0}`,
      );
    }
    if (getAnchorIdFromIndex != null || getAnchorIndexFromId != null) {
      if (getAnchorIdFromIndex == null || getAnchorIndexFromId == null) {
        throw new Error(
          'FastList: You must define BOTH getAnchorIndexFromId and getAnchorIdFromIndex, or neither',
        );
      }
    }
  }

  componentDidMount() {
    if (this.scrollView.current != null) {
      const contentOffset =
        this.props.horizontal === true
          ? {x: this.scrollPosValue}
          : {y: this.scrollPosValue};
      // @ts-expect-error - attachNativeEvent() is not in the TS declaration.
      this.scrollPosValueAttachment = Animated.attachNativeEvent(
        this.scrollView.current,
        'onScroll',
        [{nativeEvent: {contentOffset}}],
      );
    }
  }

  getSnapshotBeforeUpdate(
    {getAnchorIdFromIndex}: FastListProps,
    prevState: FastListState,
  ): null | true {
    const {
      props: {EXPERIMENTAL_enableAnchorWhileScrolling = false},
      state: {isFirstLayout},
    } = this;
    if (
      !EXPERIMENTAL_enableAnchorWhileScrolling &&
      this.disableAnchoringTimeout != null
    ) {
      return null;
    }
    // We don't want to attempt to find or update anchors on initial layouts, since it
    // will thrash the custom anchors if they exist, and we can't assume that
    // scroll positions will be accurate relative to rendered items, yet
    if (
      getAnchorIdFromIndex == null ||
      isFirstLayout ||
      isFirstLayout !== prevState.isFirstLayout
    ) {
      // We still want to let `DidUpdate` know there is a custom scroll anchor
      // to snap too, however
      return this.scrollAnchor.hasAnchor() || null;
    }
    this.scrollAnchor.findOrUpdateAnchor(getAnchorIdFromIndex, prevState.items);
    return this.scrollAnchor.hasAnchor() || null;
  }

  componentDidUpdate(
    prevProps: FastListProps,
    prevState: FastListState,
    shouldAnchorScroll: boolean | undefined,
  ) {
    if (prevProps.scrollPosValue !== this.props.scrollPosValue) {
      throw new Error('FastList: scrollPosValue cannot changed after mounting');
    }
    // If we depended on a measurement from `onLayout` then we have to manually
    // fire a measure event to restore scroll position, otherwise we may
    // attempt to scroll too early
    if (!this.state.isFirstLayout && prevState.isFirstLayout) {
      if (this.props.chunkBase == null) {
        // @ts-expect-error
        this.scrollView.current?.measure(() => this.restoreScrollPosition());
      }
    } else if (shouldAnchorScroll) {
      // NOTE(amadeus): May need to put this in a measure, but it's working for
      // now, so going to leave it
      this.anchorScroll();
    }
  }

  // When changing from horizontal to vertical scrolling (and potentially other
  // complex scenarios), this method can be used to manually reset the state of
  // the FastList. This enables a faster update to the scroll position.  By
  // calculating a new `initialContentOffset` (like upon first mount), we can
  // trigger a new render and update the scroll position in the same frame.
  reset() {
    const {
      props: {chunkBase},
      state: {fastListComputer, items, isFirstLayout},
    } = this;
    if (isFirstLayout) {
      return;
    }
    this.setState(
      this.getInitialState(chunkBase ?? 0, fastListComputer, false, items),
    );
  }

  componentWillUnmount() {
    if (this.scrollPosValueAttachment != null) {
      this.scrollPosValueAttachment.detach();
    }
    cancelAnimationFrame(this.renderUpdate);
    cancelAnimationFrame(this.deferredCompute);
  }

  anchorScroll() {
    const {
      props: {getAnchorIndexFromId},
      state: {fastListComputer},
    } = this;
    if (getAnchorIndexFromId == null) {
      return;
    }
    const {anchorOffset} = this.scrollAnchor;
    if (anchorOffset == null) {
      return;
    }
    const index = this.scrollAnchor.getAnchorIndex(getAnchorIndexFromId);
    if (index == null) {
      return;
    }
    const itemCoords = fastListComputer.computeScrollPosition(
      index.section,
      index.item,
    );
    if (itemCoords == null) {
      return;
    }
    if (this.scrollPos === itemCoords.scrollPosition - anchorOffset) {
      return;
    }
    this.scrollTo(itemCoords.scrollPosition - anchorOffset);
  }

  getScrollPositionFromEvent(
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ): number {
    return this.props.horizontal
      ? event.nativeEvent.contentOffset.x
      : event.nativeEvent.contentOffset.y;
  }

  isVisible = (layoutStart: number): boolean => {
    return (
      layoutStart >= this.scrollPos &&
      layoutStart <= this.scrollPos + this.containerSize
    );
  };

  scrollToTop = (animated: boolean = true) => {
    this.scrollView?.current?.scrollTo({x: 0, y: 0, animated});
  };

  scrollToLocation = ({
    section,
    item,
    animated = false,
    orientation = 'top',
    paddingStart = 0,
    paddingEnd = 0,
    setAnchor = false,
  }: ScrollToLocationProps): boolean => {
    const {current: scrollView} = this.scrollView;
    if (scrollView == null) {
      return false;
    }
    const {
      props: {getAnchorIdFromIndex},
      state: {fastListComputer},
    } = this;

    const itemCoords = fastListComputer.computeScrollPosition(section, item);
    if (itemCoords == null) {
      return false;
    }
    if (
      orientation === 'visible' &&
      this.isVisible(itemCoords.scrollPosition)
    ) {
      return false;
    }

    const scrollPosition = this._calculateScrollPosition({
      itemCoords,
      fullSize: fastListComputer.getSize(),
      orientation,
      paddingStart,
      paddingEnd,
    });

    // Setting anchors with animated scrolls is not really possible
    if (!animated && setAnchor && getAnchorIdFromIndex != null) {
      this.scrollAnchor.setCustomAnchor(
        getAnchorIdFromIndex,
        itemCoords.scrollPosition - (scrollPosition ?? 0),
        section,
        item,
      );
    }
    if (scrollPosition != null && scrollPosition !== this.scrollPos) {
      // If we set a custom anchor and need to perform a scrollTo, we should
      // ignore the next scroll event to prevent wiping out the custom anchor
      this.scrollPosValue.setValue(scrollPosition);
      scrollView.scrollTo({
        ...this._scrollPositionToPoint(scrollPosition),
        animated,
      });
      return true;
    }
    // We didn't need to perform any scroll
    return false;
  };

  scrollTo = (scrollPosition: number, animated: boolean = false): boolean => {
    const {
      scrollView: {current: scrollView},
      state: {fastListComputer},
    } = this;
    if (scrollView == null) {
      return false;
    }
    const scrollableRange = fastListComputer.getSize() - this.containerSize;
    if (
      scrollPosition <= scrollableRange &&
      scrollPosition !== this.scrollPos
    ) {
      scrollView.scrollTo({
        ...this._scrollPositionToPoint(scrollPosition),
        animated,
      });
      return true;
    }
    return false;
  };

  handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {
      props: {
        contentInset = DEFAULT_INSET,
        horizontal,
        onScroll,
        onEndReached,
        endReachedThreshold,

        EXPERIMENTAL_enableAnchorWhileScrolling = false,
      },
      state: {fastListComputer, hasReachedEndBefore},
    } = this;
    const layoutSize = horizontal
      ? event.nativeEvent.layoutMeasurement.width
      : event.nativeEvent.layoutMeasurement.height;
    const contentInsetStart =
      (horizontal ? contentInset.left : contentInset.top) ?? 0;
    const contentInsetEnd =
      (horizontal ? contentInset.right : contentInset.bottom) ?? 0;
    this.containerSize = layoutSize - contentInsetStart - contentInsetEnd;

    const scrollPos = Math.min(
      // Clean out scroll bounce noise
      Math.max(0, this.getScrollPositionFromEvent(event)),
      // If there's ever a mismatch between computed size and scroll size, we
      // need to ensure we don't report a scroll position that's invalid for
      // the fastListComputer to handle
      fastListComputer.getSize() - this.containerSize,
    );
    this.scrollManager.setScrollSpeed(scrollPos);
    this.scrollPos = scrollPos;
    onScroll?.(event);
    if (this.deferNextCompute) {
      this.deferNextCompute = false;
      cancelAnimationFrame(this.deferredCompute);
      this.deferredCompute = requestAnimationFrame(() => this.computeBlocks());
    } else {
      this.computeBlocks();
    }
    if (!EXPERIMENTAL_enableAnchorWhileScrolling) {
      clearTimeout(this.disableAnchoringTimeout);
      this.disableAnchoringTimeout = setTimeout(() => {
        clearTimeout(this.disableAnchoringTimeout);
        this.disableAnchoringTimeout = undefined;
      }, 100);
    }

    // No need to do extra computation if we're gonna just toss it anyways
    if (onEndReached != null) {
      const contentSize = horizontal
        ? event.nativeEvent.contentSize.width
        : event.nativeEvent.contentSize.height;
      const scrollableRange = Math.ceil(
        contentSize - (endReachedThreshold ?? 0) - layoutSize,
      );
      const scrolledPosition = Math.ceil(scrollPos);
      const atBottom = scrolledPosition >= scrollableRange;

      if (atBottom && !hasReachedEndBefore) {
        // Try not to keep firing unless we've scroll up and back down.
        this.setState({hasReachedEndBefore: true});
        onEndReached({distanceFromEnd: scrolledPosition - scrollableRange});
      } else if (!atBottom && hasReachedEndBefore) {
        this.setState({hasReachedEndBefore: false});
      }
    }
  };

  restoreScrollPosition() {
    const {
      initialScrollItem,
      initialScrollSection = 0,
      initialScrollOrientation = 'visible',
      initialScrollStart,
    } = this.props;
    // There's nowhere to initialize too
    if (
      initialScrollItem == null &&
      initialScrollSection <= 0 &&
      initialScrollStart == null
    ) {
      this.computeBlocks();
      return;
    }
    // If we don't actually perform a scroll from the initialization data, then
    // we must manually call computeBlocks
    if (initialScrollStart != null) {
      this.scrollTo(initialScrollStart, false);
    } else if (
      this.scrollToLocation({
        section: initialScrollSection,
        item: initialScrollItem ?? -1,
        orientation: initialScrollOrientation,
        paddingEnd: SCROLL_TO_BOTTOM_PADDING,
        setAnchor: true,
      })
    ) {
      this.deferNextCompute = true;
    } else {
      this.scrollPosValue.setValue(0);
      cancelAnimationFrame(this.deferredCompute);
      this.deferredCompute = requestAnimationFrame(() => this.computeBlocks());
    }
  }

  handleLayout = (event: LayoutChangeEvent) => {
    const {nativeEvent} = event;
    const {
      state: {isFirstLayout, fastListComputer},
      props: {contentInset = DEFAULT_INSET, onLayout, horizontal, chunkBase},
    } = this;

    const containerSize = horizontal
      ? nativeEvent.layout.width
      : nativeEvent.layout.height;
    const contentInsetStart =
      (horizontal ? contentInset.left : contentInset.top) ?? 0;
    const contentInsetEnd =
      (horizontal ? contentInset.right : contentInset.bottom) ?? 0;
    this.containerSize = containerSize - contentInsetStart - contentInsetEnd;
    if (chunkBase == null) {
      fastListComputer.setInfo(this.containerSize);
    }
    this.scrollManager.containerSize = this.containerSize;
    onLayout?.(event, this);
    if (isFirstLayout) {
      // If we haven't rendered anything yet, we can now compute our items
      if (chunkBase == null) {
        this.setState(
          this.getInitialState(this.containerSize, fastListComputer, false),
        );
      } else {
        this.restoreScrollPosition();
      }
    } else {
      this.computeBlocks();
    }
  };

  computeBlocks() {
    const {
      props: {batchesToRender = DEFAULT_BATCHES_TO_RENDER, chunkBase},
      state: {fastListComputer, items},
    } = this;
    const nextState = computeBlock(
      chunkBase ?? this.containerSize,
      this.scrollPos,
      batchesToRender,
    );
    if (
      nextState.batchSize !== this.state.batchSize ||
      nextState.blockStart !== this.state.blockStart ||
      nextState.blockEnd !== this.state.blockEnd
    ) {
      console.log('htht - setState');
      this.setState({
        ...nextState,
        ...fastListComputer.compute(
          nextState.blockStart,
          nextState.blockEnd,
          items,
        ),
        isFirstLayout: false,
      });
    }
  }

  handleMomentumScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const {onScrollEnd} = this.props;
    this.scrollManager.debouncedScrollComplete();
    onScrollEnd?.(event);
  };

  renderItems() {
    const {
      props: {
        disableStickySections = false,
        renderHeader = renderDefaultEmpty,
        renderFooter = renderDefaultEmpty,
        renderSection = renderDefaultEmpty,
        renderItem,
        renderSectionFooter = renderDefaultEmpty,
        renderEmpty,
        optimizeListItemRender = false,
        disableContentWrappers = false,
      },
      state: {items},
    } = this;
    console.log('htht - render');
    // We cant use default params here because horizontal can be `null`
    const horizontal = this.props.horizontal ?? false;

    if (renderEmpty != null && this.isEmpty()) {
      return renderEmpty();
    }

    const sectionLayoutPositions: number[] = [];
    items.forEach(({type, layoutStart}) => {
      if (type === FastListItemTypes.SECTION) {
        sectionLayoutPositions.push(layoutStart);
      }
    });
    const children: React.ReactChild[] = [];
    for (const {type, key, layoutStart, layoutSize, section, item} of items) {
      if (layoutSize === 0) {
        continue;
      }

      // NOTE: The below keys are purposefully strings. For some reason, reusing numerical keys breaks
      // React Native's list rendering.
      switch (type) {
        case FastListItemTypes.SPACER: {
          children.push(
            <FastListSpacer
              key={`${key}`}
              horizontal={horizontal}
              layoutSize={layoutSize}
            />,
          );
          break;
        }
        case FastListItemTypes.HEADER: {
          children.push(
            <FastListHeaderFooterRenderer
              key={`${key}`}
              horizontal={horizontal}
              disableWrapper={disableContentWrappers}
              layoutSize={layoutSize}
              scrollManager={this.scrollManager}>
              {optimizeListItemRender
                ? renderHeader
                : (...args) => renderHeader(...args)}
            </FastListHeaderFooterRenderer>,
          );
          break;
        }
        case FastListItemTypes.FOOTER: {
          children.push(
            <FastListHeaderFooterRenderer
              key={`${key}`}
              horizontal={horizontal}
              disableWrapper={disableContentWrappers}
              layoutSize={layoutSize}
              scrollManager={this.scrollManager}>
              {optimizeListItemRender
                ? renderFooter
                : (...args) => renderFooter(...args)}
            </FastListHeaderFooterRenderer>,
          );
          break;
        }
        case FastListItemTypes.SECTION: {
          sectionLayoutPositions.shift();
          children.push(
            <FastListSectionRenderer
              key={`${key}`}
              horizontal={horizontal}
              disableWrapper={disableContentWrappers}
              layoutStart={layoutStart}
              layoutSize={layoutSize}
              nextSectionLayoutPosition={sectionLayoutPositions[0]}
              scrollPosValue={
                !disableStickySections ? this.scrollPosValue : undefined
              }
              section={section}
              scrollManager={this.scrollManager}>
              {optimizeListItemRender
                ? renderSection
                : (...args) => renderSection(...args)}
            </FastListSectionRenderer>,
          );
          break;
        }
        case FastListItemTypes.ITEM: {
          children.push(
            <FastListItemRenderer
              key={`${key}`}
              horizontal={horizontal}
              disableWrapper={disableContentWrappers}
              layoutSize={layoutSize}
              section={section}
              item={item}
              scrollManager={this.scrollManager}>
              {optimizeListItemRender
                ? renderItem
                : (...args) => renderItem(...args)}
            </FastListItemRenderer>,
          );
          break;
        }
        case FastListItemTypes.SECTION_FOOTER: {
          children.push(
            <FastListSectionFooterRenderer
              key={`${key}`}
              horizontal={horizontal}
              disableWrapper={disableContentWrappers}
              layoutSize={layoutSize}
              section={section}
              scrollManager={this.scrollManager}>
              {optimizeListItemRender
                ? renderSectionFooter
                : (...args) => renderSectionFooter(...args)}
            </FastListSectionFooterRenderer>,
          );
          break;
        }
      }
    }
    return children;
  }

  isEmpty() {
    return (
      this.props.sections.reduce(
        (length, itemLength) => length + itemLength,
        0,
      ) === 0
    );
  }

  handleScrollBeginDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Clean out all anchors if they exist
    this.scrollAnchor.handleUserScroll();
    this.props.onScrollBeginDrag?.(event);
  };

  render() {
    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      renderSection,
      renderItem,
      sectionSize,
      itemSize,
      sections,
      insetStart,
      insetEnd,
      renderEmpty,
      stickyHeaderFooter = false,
      onScrollBeginDrag,
      getAnchorIdFromIndex,
      getAnchorIndexFromId,
      removeClippedSubviews = isAndroid(),
      onContentSizeChange,
      ...props
    } = this.props;
    return (
      <FastListScrollManagerContext.Provider value={this.scrollManager}>
        <ScrollView
          {...props}
          accessibilityRole="list"
          ref={this.scrollView}
          scrollEventThrottle={16}
          contentOffset={this.state.initialContentOffset}
          onScroll={this.handleScroll}
          onLayout={this.handleLayout}
          onMomentumScrollEnd={this.handleMomentumScrollEnd}
          onScrollBeginDrag={this.handleScrollBeginDrag}
          removeClippedSubviews={removeClippedSubviews}
          onContentSizeChange={onContentSizeChange}>
          {this.renderItems()}
        </ScrollView>
      </FastListScrollManagerContext.Provider>
    );
  }
}
