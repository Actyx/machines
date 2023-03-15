type Listener<T> = (message: T) => unknown;

export type Obs<T extends any> = {
  sub: (listener: Listener<T>) => () => unknown;
  unsub: (listener: Listener<T>) => void;
  emit: (t: T) => unknown[];
};

export namespace Obs {
  export const make = <T extends any>(): Obs<T> => {
    const set = new Set<Listener<T>>();

    const unsub: Obs<T>["unsub"] = (listener) => {
      set.delete(listener);
    };

    const sub: Obs<T>["sub"] = (listener) => {
      set.add(listener);
      return () => unsub(listener);
    };

    const emit: Obs<T>["emit"] = (data) => {
      const results = [];
      for (const listener of set) {
        results.push(listener(data));
      }
      return results;
    };

    return {
      sub,
      unsub,
      emit,
    };
  };
}
