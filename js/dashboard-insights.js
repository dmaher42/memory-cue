import { addLessonToWeek, getWeekIdFromDate } from './modules/planner.js';

const WEATHER_FALLBACK = {
  latitude: -33.8688,
  longitude: 151.2093,
  label: 'Sydney, AU'
};

const WEATHER_CODE_MAP = {
  0: { label: 'Clear skies', icon: '☀️' },
  1: { label: 'Mainly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅️' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Foggy', icon: '🌫️' },
  48: { label: 'Freezing fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌧️' },
  61: { label: 'Light rain', icon: '🌦️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  77: { label: 'Snow grains', icon: '🌨️' },
  80: { label: 'Rain showers', icon: '🌦️' },
  81: { label: 'Heavy showers', icon: '🌧️' },
  82: { label: 'Violent showers', icon: '🌧️' },
  85: { label: 'Snow showers', icon: '🌨️' },
  86: { label: 'Heavy snow showers', icon: '🌨️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Storm with hail', icon: '⛈️' },
  99: { label: 'Heavy hail', icon: '⛈️' }
};

const weatherElements = {
  status: document.getElementById('weatherStatus'),
  temperature: document.getElementById('weatherTemperature'),
  description: document.getElementById('weatherDescription'),
  location: document.getElementById('weatherLocation'),
  wind: document.getElementById('weatherWind'),
  humidity: document.getElementById('weatherHumidity'),
  feelsLike: document.getElementById('weatherFeelsLike'),
  footnote: document.getElementById('weatherFootnote'),
  icon: document.getElementById('weatherIcon')
};

const newsElements = {
  status: document.getElementById('newsStatus'),
  content: document.getElementById('newsContent'),
  headline: document.getElementById('newsHeadline'),
  source: document.getElementById('newsSource'),
  topStories: document.getElementById('newsTopStories'),
  primaryLink: document.getElementById('newsPrimaryLink'),
  footnote: document.getElementById('newsFootnote')
};

const NEXT_LESSON_TITLE_KEY = 'memoryCue:dashboardNextLessonTitle';
const NEXT_LESSON_FOCUS_KEY = 'memoryCue:dashboardNextLessonFocus';

const nextLessonElements = {
  title: document.getElementById('dashboard-next-lesson-title'),
  focus: document.getElementById('dashboard-next-lesson-focus'),
  button: document.querySelector('[data-copy-next-lesson]'),
  feedback: document.querySelector('[data-next-lesson-feedback]')
};

const hasStorageSupport = () => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

const readNextLessonValue = (key) => {
  if (!hasStorageSupport() || !key) {
    return '';
  }
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeNextLessonValue = (key, value) => {
  if (!hasStorageSupport() || !key) {
    return;
  }
  try {
    if (typeof value === 'string' && value.trim().length) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* noop */
  }
};

const clearNextLessonFeedback = () => {
  if (!nextLessonElements.feedback) {
    return;
  }
  nextLessonElements.feedback.textContent = '';
  nextLessonElements.feedback.classList.remove('text-error', 'text-success');
};

const setNextLessonFeedback = (message, tone = 'neutral') => {
  if (!nextLessonElements.feedback) {
    return;
  }
  if (!message) {
    clearNextLessonFeedback();
    return;
  }
  nextLessonElements.feedback.textContent = message;
  nextLessonElements.feedback.classList.remove('text-error', 'text-success');
  if (tone === 'error') {
    nextLessonElements.feedback.classList.add('text-error');
  } else if (tone === 'success') {
    nextLessonElements.feedback.classList.add('text-success');
  }
};

const canUsePlannerShortcut = () =>
  typeof addLessonToWeek === 'function' && typeof getWeekIdFromDate === 'function';

async function handleNextLessonCopy(event) {
  event.preventDefault();
  if (!nextLessonElements.title || !nextLessonElements.focus) {
    return;
  }

  const title = nextLessonElements.title.value.trim();
  const focus = nextLessonElements.focus.value.trim();

  if (!title || !focus) {
    setNextLessonFeedback('Add a lesson title and focus first.', 'error');
    if (!title) {
      nextLessonElements.title.focus();
    } else {
      nextLessonElements.focus.focus();
    }
    return;
  }

  const button = nextLessonElements.button;
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }

  try {
    const weekId = getWeekIdFromDate();
    const dayIndex = new Date().getDay();
    await addLessonToWeek(weekId, {
      dayIndex,
      title,
      summary: focus
    });
    nextLessonElements.title.value = '';
    nextLessonElements.focus.value = '';
    writeNextLessonValue(NEXT_LESSON_TITLE_KEY, '');
    writeNextLessonValue(NEXT_LESSON_FOCUS_KEY, '');
    setNextLessonFeedback('Lesson copied to your planner.', 'success');
  } catch (error) {
    console.error('Memory Cue next lesson planner shortcut', error);
    setNextLessonFeedback('Unable to copy to planner right now. Try again soon.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

function initNextLessonPlannerShortcut() {
  if (!nextLessonElements.title || !nextLessonElements.focus) {
    return;
  }

  const storedTitle = readNextLessonValue(NEXT_LESSON_TITLE_KEY);
  const storedFocus = readNextLessonValue(NEXT_LESSON_FOCUS_KEY);
  if (storedTitle && !nextLessonElements.title.value) {
    nextLessonElements.title.value = storedTitle;
  }
  if (storedFocus && !nextLessonElements.focus.value) {
    nextLessonElements.focus.value = storedFocus;
  }

  const handleInput = (field, key) => {
    if (!field) {
      return;
    }
    field.addEventListener('input', () => {
      writeNextLessonValue(key, field.value);
      clearNextLessonFeedback();
    });
  };

  handleInput(nextLessonElements.title, NEXT_LESSON_TITLE_KEY);
  handleInput(nextLessonElements.focus, NEXT_LESSON_FOCUS_KEY);

  const button = nextLessonElements.button;
  if (!button) {
    return;
  }

  if (!canUsePlannerShortcut()) {
    button.disabled = true;
    button.setAttribute('title', 'Planner tools are unavailable right now.');
    setNextLessonFeedback('Planner tools are unavailable right now.', 'error');
    return;
  }

  button.addEventListener('click', handleNextLessonCopy);
}

function safeText(target, value) {
  if (target) {
    target.textContent = value;
  }
}

function formatTimeLabel(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function resolveWeatherDescription(code) {
  return WEATHER_CODE_MAP[code] || { label: 'Latest weather', icon: '⛅️' };
}

async function fetchWeather(latitude, longitude) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude.toFixed(3));
  url.searchParams.set('longitude', longitude.toFixed(3));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('wind_speed_unit', 'kmh');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error('Unable to fetch weather');
  }
  return response.json();
}

async function fetchLocationName(latitude, longitude) {
  const endpoint = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  endpoint.searchParams.set('latitude', latitude);
  endpoint.searchParams.set('longitude', longitude);
  endpoint.searchParams.set('localityLanguage', 'en');

  const response = await fetch(endpoint.toString());
  if (!response.ok) {
    throw new Error('Unable to resolve location');
  }

  const data = await response.json();
  const locality = data.locality || data.city || data.principalSubdivision || data.countryName;
  const country = data.countryCode ? data.countryCode.toUpperCase() : '';
  if (locality && country) {
    return `${locality}, ${country}`;
  }
  return locality || country || null;
}

async function updateWeatherSummary(coords) {
  if (!weatherElements.status) {
    return;
  }

  safeText(weatherElements.status, 'Loading local weather…');

  try {
    const [weatherData, prettyLocation] = await Promise.all([
      fetchWeather(coords.latitude, coords.longitude),
      fetchLocationName(coords.latitude, coords.longitude).catch(() => coords.label || null)
    ]);

    const current = weatherData.current || {};
    const description = resolveWeatherDescription(current.weather_code);

    safeText(weatherElements.temperature, `${Math.round(current.temperature_2m ?? 0)}°C`);
    safeText(weatherElements.description, description.label);
    safeText(weatherElements.location, prettyLocation || coords.label || 'Your area');
    safeText(weatherElements.wind, `${Math.round(current.wind_speed_10m ?? 0)} km/h`);
    safeText(weatherElements.humidity, `${Math.round(current.relative_humidity_2m ?? 0)}%`);
    safeText(weatherElements.feelsLike, `${Math.round(current.apparent_temperature ?? current.temperature_2m ?? 0)}°C`);
    safeText(weatherElements.status, `Updated at ${formatTimeLabel(current.time)}.`);
    safeText(weatherElements.footnote, 'Powered by Open-Meteo');

    if (weatherElements.icon) {
      weatherElements.icon.textContent = description.icon;
    }
  } catch (error) {
    safeText(weatherElements.status, 'Unable to load weather right now. Try again later.');
    console.error('Memory Cue weather', error);
  }
}

function requestWeather() {
  if (!weatherElements.status) {
    return;
  }

  if (!navigator.geolocation) {
    updateWeatherSummary(WEATHER_FALLBACK);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      updateWeatherSummary({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });
    },
    () => {
      updateWeatherSummary(WEATHER_FALLBACK);
    },
    {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 5 * 60 * 1000
    }
  );
}

function buildStoryLink(story, index) {
  const listItem = document.createElement('li');
  const link = document.createElement('a');
  const order = document.createElement('span');
  const body = document.createElement('div');
  const title = document.createElement('p');
  const source = document.createElement('p');

  const storyUrl = story.url || `https://news.ycombinator.com/item?id=${story.objectID}`;
  link.href = storyUrl;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.className = 'flex items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:border-base-300 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  order.className = 'text-xs font-semibold uppercase tracking-[0.3em] text-base-content/50';
  order.textContent = `${index + 1}`.padStart(2, '0');

  title.className = 'font-medium text-base-content';
  title.textContent = story.title || 'Untitled story';

  source.className = 'text-xs text-base-content/60';
  source.textContent = extractHostname(storyUrl);

  body.className = 'space-y-1';
  body.append(title, source);

  link.append(order, body);
  listItem.append(link);
  return listItem;
}

function extractHostname(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch (error) {
    return 'news.ycombinator.com';
  }
}

async function fetchTopStories() {
  const response = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page');
  if (!response.ok) {
    throw new Error('Unable to fetch news');
  }
  return response.json();
}

async function updateNewsCard() {
  if (!newsElements.status) {
    return;
  }

  safeText(newsElements.status, 'Loading top stories…');

  try {
    const data = await fetchTopStories();
    const stories = Array.isArray(data.hits) ? data.hits.slice(0, 4) : [];

    if (!stories.length) {
      throw new Error('No news stories returned');
    }

    const leadStory = stories[0];
    const leadUrl = leadStory.url || `https://news.ycombinator.com/item?id=${leadStory.objectID}`;
    safeText(newsElements.headline, leadStory.title || 'Top story');
    safeText(newsElements.source, extractHostname(leadUrl));

    if (newsElements.primaryLink) {
      newsElements.primaryLink.href = leadUrl;
    }

    if (newsElements.topStories) {
      newsElements.topStories.textContent = '';
      stories.slice(1, 4).forEach((story, index) => {
        newsElements.topStories.appendChild(buildStoryLink(story, index + 1));
      });
    }

    if (newsElements.content) {
      newsElements.content.classList.remove('hidden');
    }

    safeText(newsElements.status, 'Top educational news is ready.');
    safeText(newsElements.footnote, `Updated ${formatTimeLabel(new Date())}`);
  } catch (error) {
    safeText(newsElements.status, 'Unable to load headlines right now.');
    if (newsElements.content) {
      newsElements.content.classList.add('hidden');
    }
    console.error('Memory Cue news', error);
  }
}

function initDashboardInsights() {
  if (typeof document === 'undefined') {
    return;
  }

  initNextLessonPlannerShortcut();

  if (weatherElements.status) {
    requestWeather();
  }

  if (newsElements.status) {
    updateNewsCard();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboardInsights, { once: true });
} else {
  initDashboardInsights();
}
