import * as helix from '@adobe/helix-importer';
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * @typedef {{documents: ImportDocument[]; parallel: boolean}} AppConfig
 * @typedef {{url: string; targetPath: string; transformerPath: string}} ImportDocument
 * @typedef {{document: ImportDocument; reason: string}} ImportFailure
 * @typedef {{docx: ArrayBuffer; html: string; md: string; path: string;}} ImportResult
 */

/**
 * 
 * @param {number} ms 
 */
const delay = async (ms) => {
    await new Promise(resolve => setTimeout(ms, resolve));
}

/**
 *
 * @param {string[]} args 
 * @returns {AppConfig}
 */
const parseArgs = (args) => {
    /** @type {AppConfig} */
    const config = {
        documents: [],
        parallel: true
    };

    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const [name, value] = arg.slice(2).split('=', 2);
            switch (name) {
                case 'parallel': {
                    switch (value) {
                        case undefined:
                        case 'true':
                            config.parallel = true;
                            break;
                        case 'false':
                            config.parallel = false;
                            break;
                        default:
                            console.warn(`Invalid value for argument --parallel '${value}'`)
                            break;
                    }
                    break;
                }
                default:
                    console.warn(`Invalid argument name '${name}'`)
                    break;
            }
        } else {
            const [url, targetPath, transformerPath] = arg.split('|');
            config.documents.push({ url, targetPath, transformerPath });
        }
    }

    return config;
};

/**
 * 
 * @param {string} url 
 * @param {number} maxRetries 
 * @param {number} delayBetweenRetries 
 * @returns 
 */
const fetchAsTextWithRetry = async (url, maxRetries = 3, delayBetweenRetries = 250) => {
    let result = null;
    for (let iter = 0; iter < maxRetries; ++iter) {
        let responseText = null;
        try {
            console.debug(`Attempt ${iter} to fetch URL ${url}`);
            const response = await fetch(url);
            if (response.status !== 200) {
                console.error(`Response status was not 200`);
                await delay(delayBetweenRetries);
                continue;
            }

            const text = await response.text();
            responseText = text;
            result = responseText;
            break;
        } catch (e) {
            console.error(`Failed to fetch URL ${url}\n${indent(e)}`);
            await delay(delayBetweenRetries);
            continue;
        }
    }

    return result;
}

/**
 * 
 * @param {unknown} text 
 * @param {number} indentSize 
 * @returns string
 */
const indent = (text, indentSize = 4) => {
    const indentText = ' '.repeat(indentSize);

    return `${text}`.split('\n').map(line => `${indentText}${line}`).join('\n');
}

/**
 * 
 * @param {string} reason 
 * @param {unknown} error 
 * @return {ImportFailure} 
 */
const importFailure = (reason, error) => {
    let reasonText = reason;
    if (!!error) {
        reasonText += `\n${indent(`${e}`)}`;
    }

    /** @type {ImportFailure} */
    const failure = {
        document: doc,
        reason: reasonText
    };

    return failure;
}

/**
 * 
 * @param {ImportDocument} doc 
 * @returns {Promise<ImportResult>}
 */
export const importDocument = async (doc) => {
    const { url, targetPath, transformerPath } = doc;

    console.debug(`Attemtping to import document\n${indent(JSON.stringify(doc, null, 4))}`);
    const htmlText = await fetchAsTextWithRetry(url);
    if (!htmlText) {
        throw importFailure('Failed to fetch URL', null);
    }

    let transformer;
    try {
        transformer = (await import(transformerPath)).default;
    } catch (e) {
        throw importFailure('Failed to import transformer', e);
    }
    let transformConfig;
    if (transformer.transformDOM) {
        transformConfig = {
            transformDOM: ({ url, document, html, params }) => transformer.transformDOM({ url, document, html, params }),
            generateDocumentPath: ({ url, document, html, params }) => targetPath
        };
    } else if (transformer.transform) {
        transformConfig = {
            transform: ({ url, document, html, params }) => transformer.transform({ url, document, html, params }).map(
                /**
                 * @param {{element: Element, path: string}}
                 */
                ({ element, path }) => ({
                    element,
                    path: `${targetPath}${targetPath.endsWith('/') ? '' : '/'}${path.slice(path.lastIndexOf('/') + 1)}`
                }))
        };
    } else {
        throw importFailure('Invalid transformer, it doesn\'t have either a transformDOM or transform function,\nsee https://github.com/adobe/helix-importer?tab=readme-ov-file#html2x-helpers');
    }
    /** @type {ImportResult} */
    let result;
    try {
        result = await helix.html2docx(url, htmlText, transformConfig, {
            createDocumentFromString: (html) => new JSDOM(html).window.document
        });
    } catch (e) {
        throw importFailure('Failed to transform html2docx', e);
    }

    try {
        await fs.mkdir(path.dirname(result.path), { recursive: true });
        await fs.writeFile(result.path, result.docx);
    } catch (e) {
        throw importFailure('Failed writing the resulting document to the filesystem', e);
    }

    console.debug(`Successfully imported document\n${indent(JSON.stringify(doc, null, 4))}`);

    return result;
}

export const main = async () => {
    global.WebImporter = helix;
    // global.URL = URL;
    /** @type {ImportFailure[]} */
    const failures = [];
    const args = process.argv.slice(2);
    const appConfig = parseArgs(args);

    if (appConfig.parallel) {
        const promises = appConfig.documents.map(doc => importDocument(doc));
        const promiseResults = await Promise.allSettled(promises);
        for (const promiseResult of promiseResults) {
            if (promiseResult.status === "rejected") {
                failures.push(promiseResult.reason);
            }
        }
    } else {
        for (const doc of appConfig.documents) {
            try {
                await importDocument(doc);
            } catch (e) {
                /** @type {ImportFailure} */
                const failure = e;
                failures.push(failure);
            }
        }
    }

    if (!!failures.length) {
        console.error(`Failed to import ${failures.length} documents`)
        for (const { document: importDocument, reason } of failures) {
            console.error(`Failed to import\n${indent(JSON.stringify(importDocument, null, 4))}\n${indent(reason)}`);
        }
    }
};

main();
