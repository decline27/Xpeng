const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const ignoreLines = fs.readFileSync(path.join(root, '.homeyignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

describe('app package contents', () => {
    test.each([
        'cleanup_report.txt',
        '/coverage/',
        '/test/',
        '/scripts/',
        '/docs/',
        'run.sh',
        'run-with-logging.js',
        'simple-log-test.js',
        'test-file-logging.js',
        'jest.config.js',
        'CLAUDE.md',
        'client-distribution-guide.md',
        '/.claude/',
        '/.omc/',
        '/.vercel/',
        '/logs/',
        '*.md',
        '/env.json',
    ])('excludes %s', (entry) => {
        expect(ignoreLines).toContain(entry);
    });

    test('keeps README.txt, which Homey uses as the App Store description', () => {
        expect(ignoreLines).not.toContain('README.txt');
    });

    test('the customer-data report is not tracked in git', () => {
        const tracked = execSync('git ls-files cleanup_report.txt', { cwd: root }).toString().trim();
        expect(tracked).toBe('');
    });

    test('no stray copies of image assets are tracked', () => {
        const tracked = execSync('git ls-files "*copy*"', { cwd: root }).toString().trim();
        expect(tracked).toBe('');
    });
});
