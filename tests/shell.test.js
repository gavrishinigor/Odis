// Проверка оболочки PWA: версия sw = версия приложения, все файлы кэша существуют,
// пути в manifest относительные (GitHub Pages живёт в подпапке /Odis/), в коде нет ключей.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../js/version.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('версия service worker совпадает с версией приложения', () => {
  const m = read('sw.js').match(/const VERSION = '([^']+)'/);
  assert.equal(m?.[1], APP_VERSION);
});

test('все файлы оболочки из sw.js существуют, и все js-модули в кэше', () => {
  const sw = read('sw.js');
  const list = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]).filter((p) => p !== './');
  for (const p of list) assert.ok(existsSync(join(ROOT, p)), `нет файла ${p}`);
  const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
  for (const js of walk('js')) assert.ok(list.includes(js), `${js} не в кэше sw.js`);
});

test('manifest: относительные пути, иконки на месте', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const k of ['start_url', 'scope', 'id']) assert.ok(!m[k].startsWith('/'), `${k} должен быть относительным`);
  for (const i of m.icons) {
    assert.ok(!i.src.startsWith('/'));
    assert.ok(existsSync(join(ROOT, i.src)), `нет иконки ${i.src}`);
  }
  assert.equal(m.display, 'standalone');
});

test('index.html: относительные пути, поля ввода не мельче 16px', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(!m[1].startsWith('/'), `абсолютный путь ${m[1]}`);
  const css = read('css/app.css');
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(+m[1] >= 11);
  assert.match(css, /\.dock-input[^}]*font-size: 16px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /viewport-fit=cover/);
});

test('в коде нет ключей и токенов', () => {
  const files = ['index.html', 'sw.js', 'manifest.webmanifest', ...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(join(ROOT, 'js/core')).map((f) => `js/core/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /sk-[A-Za-z0-9_-]{16,}/, `похоже на ключ в ${f}`);
});

test('все js-файлы приложения синтаксически корректны (модули для браузера)', async () => {
  const { execFileSync } = await import('node:child_process');
  const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
  for (const f of [...walk('js'), 'sw.js']) {
    try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); }
    catch (e) { assert.fail(`${f}: ${String(e.stderr).split('\n').slice(0, 5).join(' ')}`); }
  }
});
