export interface QItem<T> {
    finished: boolean;
    data: T;
}

export class Queue<T> {
    public readonly items: QItem<T>[];

    constructor(items: QItem<T>[]) {
        this.items = [...items];
    }

    public add(item: QItem<T> | QItem<T>[]): Queue<T> {
        const newItems = Array.isArray(item) ? item : [item];
        return new Queue(this.items.concat(...newItems));
    }

    public addData(data: T | T[]): Queue<T> {
        const newData = Array.isArray(data) ? data : [data];
        return this.add(newData.map((d) => ({ finished: false, data: d})));
    }

    public length(): number {
        return this.items.length;
    }

    public numWaiting(): number {
        return this.items.filter((i) => !i.finished).length;
    }

    public next(): T | undefined {
        const item = this.items.find((i) => !i.finished);
        return item && item.data;
    }

    public finish(): Queue<T> {
        const idxFinished = this.items.findIndex((i) => !i.finished);
        const items = this.items.map((i, idx) => idx !== idxFinished ? i : { finished: true, data: i.data});
        return new Queue(items);
    }

    public find(func: (data: T) => boolean): T | undefined {
        const item = this.items.find((i) => func(i.data));
        return item && item.data;
    }
}
