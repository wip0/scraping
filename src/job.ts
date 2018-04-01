import * as path from 'path';
import * as P from 'puppeteer';
import * as fs from 'fs-extra';
import * as H from 'handlebars';
import deepEqual = require('deep-equal');

const JSON5 = require('json5');
import { DataEntryOptions, DataOptions, DataType, DataEntry, getDataEntry, getNumChild } from "./data";
import {Queue, QItem} from './queue';
///////////////////////////////////////////////////////////////////////////////////////////
export interface DataLoopOption {
    pre?: string;
    post?: string;
    tplSelector: string;
    regex?: string;
    regFlag?: string;
}

export interface LoopOption {
    tplSelector: string;
    only?: number[];
    excludes?: number[];
}

export interface LoopEntryOption {
    name: string | DataLoopOption;
    value: string | number | DataLoopOption;
    unit?: string | DataLoopOption;
    year?: string | DataLoopOption;
}

export interface DataLoopEntryOptions {
    loop: LoopOption | LoopOption[];
    data: LoopEntryOption;
    dataType?: DataType;
}

export interface Job {
    options: {
        queue: string;
        tplJson: string;
        merge: {
            delim: string;
            json: string;
            csv: string;
        }
    },
    contexts: any[];
    action: {
        tplUrl: string;
        data: Array<DataEntryOptions | DataLoopEntryOptions>;
    }
}

export type QContextItem = QItem<object>;
export type QContext = Queue<object>;

function isDataLoopEntryOptions(opt: DataEntryOptions | DataLoopEntryOptions): opt is DataLoopEntryOptions {
    return (<DataLoopEntryOptions> opt).loop != null;
}
///////////////////////////////////////////////////////////////////////////////////////////
function loadJSON(fn: string): Promise<any> {
    return fs.readFile(fn, 'utf-8').then((data: string) => {
        //const data = buf.toString();
        return JSON5.parse(data);
    });
}

export function compile(tpl: string, context: object): string {
    const hUrl = H.compile(tpl);
    return hUrl(context);
}

export function loadJob(fn: string): Promise<[Job, QContext]> {
    return loadJSON(fn).then((data: any) => {
        const job = <Job> data;
        const qFile = job.options.queue;
        const qPath = path.dirname(qFile);
        return fs.ensureDir(qPath).then(() => {
            return loadJSON(qFile).catch((error: Error) => {
                return <QContextItem[]> [];
            });
        }).then((contextItems: QContextItem[]) => {
            const qOld = new Queue(contextItems);
            const newContexts = job.contexts.filter((c: any) => !qOld.find((data: any) => deepEqual(c, data)));
            const qNew = qOld.addData(newContexts);
            return <[Job, QContext]> [job, qNew];
        });
    });
}

export function getAllOutputs(job: Job): string[] {
    return job.contexts.map((c) => compile(job.options.tplJson, c));
}

export function processQueue(page: P.Page, job: Job, qContext: QContext): Promise<void>  {
    const qFile = job.options.queue;
    const context = qContext.next();
    const func = context != null ? async () => {
        const key = JSON.stringify(context);
        console.log(`[${new Date().toLocaleTimeString()}] context=${key}`);
        const url = compile(job.action.tplUrl, context);
        console.log(` > ${url}`);
        await page.goto(url);
        await page.waitFor(500);    // wait for a bit

        return scrape(page, job.action.data).then((result: DataEntry[]) => {
            const outFile = compile(job.options.tplJson, context);
            const outPath = path.dirname(outFile);
            return fs.ensureDir(outPath).then(() => {
                return fs.writeJSON(outFile, result, { spaces: 4});
            });
        }).then(() => {
            const nextQContext = qContext.finish();
            return fs.writeJSON(qFile, nextQContext.items, { spaces: 4}).then(() => {
                return processQueue(page, job, nextQContext);
            });
        });
    } : () => {
        return fs.unlink(qFile).catch((error: Error) => {
            console.warn(`Cannot delete ${qFile} error: ${error.stack}`);
        });
    };
    return func();
}

export function scrape(page: P.Page, opt: Array<DataEntryOptions | DataLoopEntryOptions>): Promise<DataEntry[]> {
    const promises = <Promise<DataEntry[]>[]> opt.map((o) => {
        return isDataLoopEntryOptions(o) ? scrapeLoop(page, o, {}) : scrapeData(page, o).then((data) => [data]);
    });

    return Promise.all(promises).then((results: Array<DataEntry[]>) => {
        return results.reduce((prev, curr) => prev.concat(...curr), []);
    });
}

export function scrapeData(page: P.Page, opt: DataEntryOptions): Promise<DataEntry> {
    return getDataEntry(page, opt);
}

export async function scrapeLoop(page: P.Page, opt: DataLoopEntryOptions, context: object): Promise<DataEntry[]> {
    // if (Array.isArray(opt.loop)) {
    //     const nextOpt = [...opt.loop];
    //     const loop = nextOpt.shift();
    //     return loop != null ? getLoopContext(page, loop, context).then((contexts) => {
    //         return [];
    //     }) : Promise.resolve([]);
    // }
    const loops = Array.isArray(opt.loop) ? opt.loop : [opt.loop];
    const contexts = await loops.reduce(async (prevLoop, currLoop) => {
        const contexts = await prevLoop;
        const promises = contexts.map((c) => getLoopContext(page, currLoop, c));
        const out = await Promise.all(promises).then((results: Array<object[]>) => {
            return results.reduce((prev, curr) => prev.concat(curr));
        });
        return out;
    }, Promise.resolve([context]));

    const promises = contexts.map((c) => {
        const optDataEntry = toDataEntryOption(opt, c);
        //console.log(JSON.stringify(c));
        return scrapeData(page, optDataEntry);
    });
    const results = await Promise.all(promises);
    return results;
}

function toIndex(data: number[], all: number): number[] {
    return data.map((v) => v >= 0 ? v : all + v + 1);
}

function getLoopContext(page: P.Page, opt: LoopOption, context: object): Promise<object[]> {
    const loopKeys = [...Object.keys(context)].filter((k) => k.indexOf('index-') === 0);
    const numLoopKey = loopKeys.length;
    const newLoopKeys = [`index-${loopKeys.length}`].concat(numLoopKey === 0 ? ['index'] : []);

    const selector = compile(opt.tplSelector, context);
    return getNumChild(page, selector).then((numChild: number) => {
        const includes = (opt.only && toIndex(opt.only, numChild)) || [...Array(numChild).keys()].map((x) => x + 1);
        const excludes = (opt.excludes && toIndex(opt.excludes, numChild)) || [];
        const indices = includes.filter((x) => excludes.indexOf(x) < 0);

        return indices.map((idx) => {
            const addedContext = newLoopKeys.reduce((prev, curr) => {
                return { ...prev, [curr]: idx};
            }, {});
            return { ...context, ...addedContext };
        })
    });
}

function toDataEntryOption(opt: DataLoopEntryOptions, context: object): DataEntryOptions {
    return {
        name: toDataOption(opt.data.name, context),
        value: toDataOption(opt.data.value, context),
        year: opt.data.year && toDataOption(opt.data.year, context),
        unit: opt.data.unit && toDataOption(opt.data.unit, context),
        dataType: opt.dataType,
    };
}

function toDataOption(opt: string | number | DataLoopOption, context: object): any | DataOptions {
    if (typeof opt !== 'object') {
        return opt;
    }

    const {tplSelector, ...rest} = opt;
    const selector = compile(tplSelector, context);
    return { ...rest, selector };
}
