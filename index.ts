require('source-map-support').install();
///////////////////////////////////////////////////////////////////////////////////////////
import * as path from 'path';
import * as P from 'puppeteer';
import * as fs from 'fs-extra';

import * as Papa from 'papaparse';
const JSON5 = require('json5');

import { loadJob, Job, processQueue, QContext, getAllOutputs } from './src/job';
import { DataType, DataEntryOptions, DataOptions, getData, getDataEntry } from './src/data';
///////////////////////////////////////////////////////////////////////////////////////////
const optLaunch: P.LaunchOptions = {
    headless: true,
    //slowMo: 200,
};

const inputFile = process.argv[2] || './job.json5';
console.log(`Loading file=${inputFile}`);
loadJob(inputFile).then(async ([job, qContext]: [Job, QContext]) => {
    const browser = await P.launch(optLaunch);
    const page = await browser.newPage();

    console.log(`Q.length = ${qContext.length()}`);
    console.time('Scraping');
    await processQueue(page, job, qContext);
    console.timeEnd('Scraping');
    await browser.close();
    
    const outputs = getAllOutputs(job);
    console.log(`> Output.lenght = ${outputs.length}`);
    console.time('Merging');
    const csv = await mergeToCSV(job.options.merge.delim, outputs);
    const outFile = job.options.merge.csv;
    await fs.writeFile(outFile, csv);
    console.timeEnd('Merging');

    console.log(` - out = ${outFile}`);
}).then(() => {
    console.log('Finish');
}).catch((error: Error) => {
    console.error(`Error: ${error.stack}`);
});

///////////////////////////////////////////////////////////////////////////////////////////
function mergeToCSV(delim: string, files: string[]): Promise<string> {
    const promises = files.map((f) => prepareToCSV(delim, f));
    return Promise.all(promises).then((results: Array<object | null>) => {
        const out = <object[]> results.filter((r) => !!r);
        return Papa.unparse(out);
    })
}

function prepareToCSV(delim: string, file: string): Promise<object | null> {
    return fs.readFile(file, 'utf-8').then((data: string) => {
        return JSON5.parse(data);
    }).then((data: object[]) => {
        const allPairs = data.map((d: any) => {
            const name = d.year != null ? `${d.name}${delim}${d.year}` : d.name;
            const pair = { name, value: d.value };
            const unit = d.unit != null ? [{ name: `${d.name}${delim}${d.unit}`, value: d.unit }] : [];
            return [pair].concat(...unit);
        }).reduce((prev, curr) => prev.concat(...curr), []);
        
        const out = allPairs.reduce((prev, curr) => {
            return { ...prev, [curr.name]: curr.value };
        }, {});
        return out;
    }).catch((error: Error) => {
        console.error(`PrepareToCSV Error: ${error.stack}`);
        return null;
    });
}
