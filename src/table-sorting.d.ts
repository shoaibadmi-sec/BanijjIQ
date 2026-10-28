import 'vue';

declare module 'vue' {
  interface ComponentCustomProperties {
    $sortRows: <T>(tableId: string, rows: readonly T[] | null | undefined) => T[];
  }

  interface GlobalComponents {
    SortableHeader: any;
  }
}

export {};
