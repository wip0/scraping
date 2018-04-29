import * as P from 'puppeteer';

export type DataType = 'string' | 'number';  // default is 'string'
export interface DataOptions {
    pre?: string;
    post?: string;
    selector: string;
    regex?: string;
    regFlag?: string;
}

export interface DataExOptions {
    dataType?: DataType;
    options: DataOptions[];
}

export interface DataEntryOptions {
    name: string | DataOptions | DataExOptions;
    value: string | number | DataOptions | DataExOptions;
    unit?: string | DataOptions;
    year?: string | DataOptions;
    dataType?: DataType;
}

export interface DataEntry {
    name: string;
    value: string | number;
    year?: string;
    unit?: string;
}

function isDataExOption(opt: DataOptions | DataExOptions): opt is DataExOptions {
    return (<DataExOptions> opt).options != null;
}

export function getText(page: P.Page, selector: string): Promise<string> {
    return page.evaluate((sel) => {
        var e = document.querySelector(sel);
        return e != null ? e.innerText : '';
    }, selector);
}

export function getNumChild(page: P.Page, selector: string): Promise<number> {
    return page.evaluate((sel) => {
        var e = document.querySelectorAll(sel)[0];
        return e != null ? e.children.length : 0;
    }, selector);
}

function getStaticData<T>(v: T): Promise<T> {
    return Promise.resolve(v);
}

function toData(value: string | number, t: DataType | undefined): string | number {
    const dataType = t || 'string';
    return dataType === 'string' ? value.toString().trim() : parseFloat(value.toString().replace(/,/g, ''));
}

function getDataFromOption(page: P.Page, opt: DataOptions, dataType: DataType | undefined): Promise<string | number> {
    return getText(page, opt.selector).then((value: string) => {
        if (!opt.regex) {
            return value;
        }

        const reg = new RegExp(opt.regex, opt.regFlag);
        const results = reg.exec(value);
        return results && results[results.length - 1] || '';
    }).then((value: string) => {
        return `${opt.pre || ''}${value}${opt.post || ''}`;
    }).then((value: string) => {
        return toData(value, dataType);
    });
}

function getDataEx(page: P.Page, opt: DataExOptions): Promise<string | number> {
    const promises = opt.options.map((o) => getDataFromOption(page, o, opt.dataType));
    return Promise.all(promises).then((results: any[]) => {
        const result = results.reduce((prev, curr) => prev + curr);
        return toData(result, opt.dataType);
    });
}

export function getData(page: P.Page, opt: string | number | DataOptions | DataExOptions, dataType: DataType | undefined): Promise<string | number> {
    if (typeof opt !== 'object') {
        return Promise.resolve(opt);
    }

    return getDataEx(page, isDataExOption(opt) ? opt : { dataType, options: [opt] });
}

export function getDataEntry(page: P.Page, opt: DataEntryOptions): Promise<DataEntry> {
    const promises = <[Promise<string>, Promise<string | number>, Promise<string | undefined>, Promise<string | undefined>]> [
        getData(page, opt.name, 'string'),
        getData(page, opt.value, opt.dataType),
        opt.year ? getData(page, opt.year, 'string') : Promise.resolve(undefined),
        opt.unit ? getData(page, opt.unit, 'string') : Promise.resolve(undefined),
    ];
    return Promise.all(promises).then(([name, value, year, unit]: [string, string | number, string | undefined, string | undefined]) => {
        let data: object = { name, value };
        if (year != null) data = {...data, year};
        if (unit != null) data = {...data, unit};
        return <DataEntry> data;
    });
}
