const query = document.querySelector('#query');
const modelSelect = document.querySelector('#model');
const results = document.querySelector('#results');
const resultCount = document.querySelector('#result-count');
const empty = document.querySelector('#empty');
const filters = [...document.querySelectorAll('[data-type]')];
const dialog = document.querySelector('#detail');
const detailContent = document.querySelector('#detail-content');
const aiForm = document.querySelector('#ai-form');
const aiQuestion = document.querySelector('#ai-question');
const aiSubmit = document.querySelector('#ai-submit');
const aiStatus = document.querySelector('#ai-status');
const aiResult = document.querySelector('#ai-result');

const telegram = window.Telegram?.WebApp;
const inTelegram = Boolean(telegram && (telegram.initData || telegram.platform !== 'unknown'));
const modelById = new Map(models.map((model) => [model.id, model]));
const plural = new Intl.PluralRules('ru');
const materialLabels = { one: 'материал', few: 'материала', many: 'материалов' };
let activeType = '';

function normalize(value) {
  return value.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const indexedCatalog = catalog.map((entry) => {
  const modelTerms = entry.models.flatMap((id) => {
    const model = modelById.get(id);
    return [model.name, model.aliases];
  });
  return {
    entry,
    searchText: normalize([
      ...modelTerms, entry.title, entry.description, entry.applies, entry.keywords,
      entry.action, entry.evidence, entry.market,
    ].join(' ')),
  };
});

function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-' + name);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function element(tag, value, className = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function metadata(entry) {
  const type = entry.type === 'manual' ? 'Руководство' : 'Разбор проблемы';
  const names = entry.models.map((id) => modelById.get(id).name).join(' / ');
  return [names, entry.evidence || type, entry.market].filter(Boolean).join(' · ');
}

function sourceLink(reference) {
  const item = document.createElement('li');
  const source = element('a', reference.title, 'source-link');
  source.href = reference.url;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.append(icon('link'));
  if (inTelegram) {
    source.addEventListener('click', (event) => {
      event.preventDefault();
      telegram.openLink(source.href);
    });
  }
  item.append(source);
  if (reference.locator || reference.access_note) {
    item.append(element('p', [reference.locator, reference.access_note].filter(Boolean).join(' · '), 'source-note'));
  }
  return item;
}

function showDetail(entry) {
  const title = element('h2', entry.title);
  title.id = 'detail-title';
  const sources = element('ul', '', 'source-list');
  sources.append(...entry.sources.map(sourceLink));
  detailContent.replaceChildren(
    element('p', metadata(entry), 'entry-meta'),
    title,
    element('p', entry.description),
    element('h3', 'Для каких машин'),
    element('p', entry.applies),
    element('h3', 'Результат и действия'),
    element('p', entry.action),
    element('h3', entry.sources.length === 1 ? 'Источник' : 'Источники'),
    sources,
  );
  dialog.showModal();
}

function renderEntry(entry) {
  const row = document.createElement('li');
  const button = element('button', '', 'entry');
  button.type = 'button';
  const badge = element('span', '', 'entry-icon ' + entry.type);
  badge.append(icon(entry.type === 'manual' ? 'file' : 'tool'));
  const content = document.createElement('span');
  content.append(
    element('span', metadata(entry), 'entry-meta'),
    element('span', entry.title, 'entry-title'),
    element('span', entry.summary, 'entry-summary'),
  );
  button.append(badge, content, icon('next', 'entry-next'));
  button.addEventListener('click', () => showDetail(entry));
  row.append(button);
  return row;
}

function render() {
  const words = normalize(query.value).split(' ').filter(Boolean);
  const matches = indexedCatalog.filter(({ entry, searchText }) => (
    (!activeType || (activeType === 'service' ? entry.service_book : activeType === entry.type))
    && (!modelSelect.value || entry.models.includes(modelSelect.value))
    && words.every((word) => searchText.includes(word))
  ));
  results.replaceChildren(...matches.map(({ entry }) => renderEntry(entry)));
  resultCount.textContent = matches.length + ' ' + materialLabels[plural.select(matches.length)];
  empty.hidden = matches.length > 0;
}

aiForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = aiQuestion.value.trim();
  if (question.length < 3) {
    aiStatus.textContent = 'Введите вопрос целиком.';
    return;
  }

  const model = modelSelect.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 125_000);
  aiSubmit.disabled = true;
  aiResult.hidden = true;
  aiStatus.textContent = 'Ищем ответ в базе знаний…';
  const unavailable = 'ИИ-поиск пока недоступен. Можно воспользоваться поиском по карточкам.';
  try {
    const response = await fetch('./api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, model }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      aiStatus.textContent = data.error || unavailable;
      return;
    }

    const content = document.createDocumentFragment();
    if (model) content.append(element('p', modelById.get(model).name, 'ai-scope'));
    for (const paragraph of data.answer.split(/\n+/)) {
      if (paragraph.trim()) content.append(element('p', paragraph));
    }
    if (data.sources.length) content.append(element('h3', 'Источники'));
    for (const source of data.sources) {
      const links = element('ul', '', 'source-list');
      links.append(...source.references.map(sourceLink));
      content.append(element('h4', source.title), links);
    }
    aiResult.replaceChildren(content);
    aiResult.hidden = false;
    aiStatus.textContent = '';
  } catch (error) {
    aiStatus.textContent = error.name === 'AbortError'
      ? 'Поиск занял слишком много времени. Попробуйте ещё раз.'
      : unavailable;
  } finally {
    clearTimeout(timeout);
    aiSubmit.disabled = false;
  }
});

for (const model of models) {
  modelSelect.add(new Option(model.name, model.id));
}
query.addEventListener('input', render);
modelSelect.addEventListener('change', render);
for (const filter of filters) {
  filter.addEventListener('click', () => {
    activeType = filter.dataset.type;
    for (const button of filters) {
      button.setAttribute('aria-pressed', String(button === filter));
    }
    render();
  });
}

if (inTelegram) {
  telegram.ready();
  telegram.expand();
}
render();
