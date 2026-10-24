import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../src/news/releases.json', import.meta.url));
const tagPattern = /^v\d+\.\d+\.\d+$/;
const imageDirectory = resolve(dirname(sourcePath), 'images');

function problem(message) {
  console.error(`What's New data: ${message}`);
  process.exit(1);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) problem(`${path} must be an object`);
  return value;
}

function localized(value, path) {
  object(value, path);
  for (const language of ['de', 'en']) {
    if (typeof value[language] !== 'string' || !value[language].trim()) {
      problem(`${path}.${language} must be non-empty text`);
    }
  }
}

function validateItem(item, path, ids) {
  object(item, path);
  if (typeof item.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) problem(`${path}.id must be a unique kebab-case id`);
  if (ids.has(item.id)) problem(`duplicate item id ${item.id}`);
  ids.add(item.id);
  localized(item.title, `${path}.title`);
  localized(item.text, `${path}.text`);
  if (item.where !== undefined) localized(item.where, `${path}.where`);
  if (item.image !== undefined) {
    object(item.image, `${path}.image`);
    if (typeof item.image.src !== 'string' || basename(item.image.src) !== item.image.src || !item.image.src.endsWith('.webp')) {
      problem(`${path}.image.src must be a .webp filename from src/news/images`);
    }
    if (!existsSync(resolve(imageDirectory, item.image.src))) problem(`${path}.image.src does not exist: ${item.image.src}`);
    localized(item.image.alt, `${path}.image.alt`);
  }
  if (item.open !== undefined && item.open !== 'settings') problem(`${path}.open has an unsupported target: ${item.open}`);
}

function semver(tag) {
  const match = tagPattern.exec(tag);
  return match ? tag.slice(1).split('.').map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validate(document) {
  object(document, 'document');
  object(document.draft, 'draft');
  if (!Array.isArray(document.draft.items)) problem('draft.items must be an array');
  if (!Array.isArray(document.releases)) problem('releases must be an array');

  const ids = new Set();
  for (let index = 0; index < document.draft.items.length; index++) {
    validateItem(document.draft.items[index], `draft.items[${index}]`, ids);
  }

  const tags = new Set();
  let previous = null;
  for (let index = 0; index < document.releases.length; index++) {
    const release = object(document.releases[index], `releases[${index}]`);
    const version = typeof release.tag === 'string' ? semver(release.tag) : null;
    if (!version) problem(`releases[${index}].tag must be a version such as v2.4.0`);
    if (tags.has(release.tag)) problem(`duplicate release tag ${release.tag}`);
    tags.add(release.tag);
    if (previous && compareVersions(previous, version) <= 0) problem('releases must be ordered newest first');
    previous = version;
    if (!Array.isArray(release.items) || release.items.length === 0) problem(`releases[${index}].items must contain at least one item`);
    for (let itemIndex = 0; itemIndex < release.items.length; itemIndex++) {
      validateItem(release.items[itemIndex], `releases[${index}].items[${itemIndex}]`, ids);
    }
  }
  return { tags, draft: document.draft };
}

function load() {
  let document;
  try {
    document = JSON.parse(readFileSync(sourcePath, 'utf8'));
  } catch (error) {
    problem(`could not parse ${sourcePath}: ${error.message}`);
  }
  validate(document);
  return document;
}

const [command, argument] = process.argv.slice(2);
if (command === '--validate') {
  load();
  console.log("What's New data is valid.");
} else if (command === '--assert-tag' && argument) {
  if (!tagPattern.test(argument)) problem(`invalid release tag ${argument}`);
  const document = load();
  if (document.draft.items.length) problem('a manually pushed tag must already have its news bundle finalized in the JSON file');
  if (document.releases.some((release) => release.tag === argument)) console.log(`News bundle ${argument} is ready.`);
  else console.log(`No player-facing news bundle for ${argument}.`);
} else if (command === '--finalize' && argument) {
  if (!tagPattern.test(argument)) problem(`invalid release tag ${argument}`);
  const document = load();
  if (document.releases.some((release) => release.tag === argument)) {
    if (document.draft.items.length) problem(`release ${argument} already exists while the draft still has items`);
    console.log(`News bundle ${argument} is already finalized.`);
  } else if (!document.draft.items.length) {
    console.log('The news draft is empty; nothing to finalize.');
  } else {
    document.releases.unshift({ tag: argument, items: document.draft.items });
    document.draft = { items: [] };
    validate(document);
    writeFileSync(sourcePath, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`Finalized ${document.releases[0].items.length} What's New items as ${argument}.`);
  }
} else {
  problem('usage: node scripts/finalize-news.mjs --validate | --assert-tag <tag> | --finalize <tag>');
}
