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

function initWindyModal() {
  const openBtn = document.querySelector('[data-action="open-windy-map"]');
  const closeBtn = document.querySelector('[data-action="close-windy-map"]');
  const modal = document.getElementById('windyWeatherModal');

  if (!openBtn || !modal) {
    return;
  }

  const wrapper = modal.querySelector('.windy-embed-wrapper');

  const loadIframe = () => {
    if (!wrapper || wrapper.dataset.loaded === 'true') {
      return;
    }

    wrapper.innerHTML = `
        <!-- TODO: Use the Windy "Embed" tool to generate this URL for your preferred zoom/location and paste it here. -->
        <iframe
          title="Windy weather map"
          style="width:100%;height:360px;border:0;border-radius:12px;"
          src="YOUR_WINDY_EMBED_URL_HERE"
          loading="lazy"
        ></iframe>`;
    wrapper.dataset.loaded = 'true';
  };

  function hideModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', handleEscape, true);
  }

  function handleEscape(event) {
    if (event.key === 'Escape' && !modal.hidden) {
      hideModal();
    }
  }

  const showModal = () => {
    modal.hidden = false;
    modal.removeAttribute('aria-hidden');
    loadIframe();
    document.addEventListener('keydown', handleEscape, true);
    if (closeBtn) {
      closeBtn.focus();
    }
  };

  openBtn.addEventListener('click', showModal);

  if (closeBtn) {
    closeBtn.addEventListener('click', hideModal);
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      hideModal();
    }
  });
}

function initDashboardInsights() {
  if (typeof document === 'undefined') {
    return;
  }

  if (weatherElements.status) {
    requestWeather();
  }

  if (newsElements.status) {
    updateNewsCard();
  }

  initWindyModal();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboardInsights, { once: true });
} else {
  initDashboardInsights();
}
