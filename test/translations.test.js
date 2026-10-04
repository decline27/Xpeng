const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jsonFiles = [
    ...fs.readdirSync(path.join(root, '.homeycompose/capabilities'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => `.homeycompose/capabilities/${f}`),
    ...['triggers', 'conditions', 'actions'].flatMap((type) => fs
        .readdirSync(path.join(root, '.homeycompose/flow', type))
        .map((f) => `.homeycompose/flow/${type}/${f}`)),
    'drivers/cars/driver.compose.json',
    'drivers/cars/driver.settings.compose.json',
    'widgets/xpeng/widget.compose.json',
];

// Units and example numbers read the same in every language
const isExempt = (key, text) => key === 'units' || key === 'placeholder' || /^[\d.]+$/.test(text) || text === 'VIN';

function collect(node, key, out) {
    if (Array.isArray(node)) {
        node.forEach((child) => collect(child, key, out));
    } else if (node && typeof node === 'object') {
        if (typeof node.en === 'string' && !isExempt(key, node.en)) out.push(node);
        Object.entries(node).forEach(([k, child]) => collect(child, k, out));
    }
}

describe('translations', () => {
    test.each(jsonFiles)('%s has Norwegian and Swedish for every text', (file) => {
        const strings = [];
        collect(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')), null, strings);
        const missing = strings.filter((s) => !s.no || !s.sv).map((s) => s.en);
        expect(missing).toEqual([]);
    });

    test.each(['en', 'no', 'sv'])('locales/%s.json has the same keys as English', (lang) => {
        const keys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (
            v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
        const en = keys(require(path.join(root, 'locales/en.json')));
        expect(keys(require(path.join(root, `locales/${lang}.json`)))).toEqual(en);
    });
});
