const fs = require('fs');
const path = require('path');
const { parse } = require('fluent-syntax');
const request = require('request-promise-native');

const TRANSLATED_MIN_PROGRESS = 0.95;
const CONTRIBUTABLE_MIN_SENTENCES = 5000;

const dataPath = path.join(__dirname, '..', 'locales');
const localeMessagesPath = path.join(__dirname, '..', 'web', 'locales');

function saveDataJSON(name, data) {
  fs.writeFileSync(
    path.join(dataPath, name + '.json'),
    JSON.stringify(data, null, 2)
  );
}

async function fetchPontoonLanguages() {
  const { data } = await request({
    uri: 'https://pontoon.mozilla.org/graphql',
    method: 'POST',
    json: true,
    body: {
      query: `{
            project(slug: "common-voice") {
              localizations {
                totalStrings
                approvedStrings
                locale {
                  code
                  name
                }
              }
            }
          }`,
      variables: null,
    },
  });
  return data.project.localizations
    .map(({ totalStrings, approvedStrings, locale }) => [
      locale.code,
      locale.name,
      approvedStrings / totalStrings,
    ])
    .concat([['en', 'English', 1]])
    .sort(([code1], [code2]) => code1.localeCompare(code2));
}

async function saveToMessages(languages) {
  const messagesPath = path.join(localeMessagesPath, 'en', 'messages.ftl');
  const messages = fs.readFileSync(messagesPath, 'utf-8');
  const newMessages = messages.replace(
    /#\s\[Languages]([\s\S]*?)#\s\[\/]/gm,
    [
      '# [Languages]',
      '## Languages',
      languages.map(([code, name]) => `${code} = ${name}`).join('\n'),
      '# [/]',
    ].join('\n')
  );
  fs.writeFileSync(messagesPath, newMessages);
}

/**
 * Saves completed locales (always merges with previously added locales)
 */
async function saveCompletedLocalesJSON(languages) {
  const fileName = 'translated';
  const completedLocalesPath = path.join(dataPath, fileName + '.json');
  const existingLocales = JSON.parse(
    fs.readFileSync(completedLocalesPath, 'utf-8')
  );
  saveDataJSON(
    fileName,
    [
      ...new Set([
        ...existingLocales,
        ...languages
          .filter(
            ([code, name, progress]) => progress >= TRANSLATED_MIN_PROGRESS
          )
          .map(l => l[0]),
      ]),
    ].sort()
  );
}

async function importPontoonLocales() {
  const languages = await fetchPontoonLanguages();
  await Promise.all([
    saveToMessages(languages),
    saveDataJSON('all', languages.map(([key]) => key)),
    saveCompletedLocalesJSON(languages),
  ]);
}

async function importContributableLocales() {
  const sentencesPath = path.join(__dirname, '..', 'server', 'data');
  const oldContributable = JSON.parse(
    fs.readFileSync(path.join(dataPath, 'contributable.json'), 'utf-8')
  );
  const names = fs.readdirSync(sentencesPath).filter(name => {
    if (oldContributable.includes(name)) {
      return true;
    }
    if (name === 'LICENSE') {
      return false;
    }
    const localeSentencesPath = path.join(sentencesPath, name);
    const count = fs
      .readdirSync(localeSentencesPath)
      .reduce(
        (count, sentencesFile) =>
          sentencesFile.endsWith('.txt')
            ? count +
              fs
                .readFileSync(
                  path.join(localeSentencesPath, sentencesFile),
                  'utf-8'
                )
                .split('\n').length
            : count,
        0
      );
    return count > CONTRIBUTABLE_MIN_SENTENCES;
  });
  saveDataJSON('contributable', names.sort());
}

async function buildLocaleNativeNameMapping() {
  const locales = fs.readdirSync(localeMessagesPath);
  const nativeNames = {};
  for (const locale of locales) {
    const messagesPath = path.join(localeMessagesPath, locale, 'messages.ftl');

    if (!fs.existsSync(messagesPath)) {
      continue;
    }

    const messages = parse(fs.readFileSync(messagesPath, 'utf-8'));
    const message = messages.body.find(
      message => message.id && message.id.name === locale
    );

    nativeNames[locale] = message ? message.value.elements[0].value : locale;
  }
  saveDataJSON('native-names', nativeNames);
}

async function importLocales() {
  await Promise.all([
    importPontoonLocales(),
    importContributableLocales(),
    buildLocaleNativeNameMapping(),
  ]);
}

importLocales().catch(e => console.error(e));
