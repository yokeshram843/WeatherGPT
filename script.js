/* ============================================================
   WeatherGPT — chat-first weather assistant
   ============================================================
   Data flow:
     1. searchWeather() geocodes a city, then fetches current +
        7-day weather from Open-Meteo and renders the snapshot.
     2. Every fetched value is stashed in `weatherContext` (a
        single object, not scattered window.* globals).
     3. askWeatherGPT() sends the user's question PLUS
        weatherContext to callWeatherGPT(), which is the only
        function that talks to the LLM. Swap its internals for
        a backend call later without touching anything else.
   ============================================================ */

const weatherContext = {
    city: null,
    latitude: null,
    longitude: null,
    temperature: null,
    feelsLike: null,
    humidity: null,
    windSpeed: null,
    visibility: null,
    pressure: null,
    weatherCode: null,
    condition: null,
    rainProbabilityToday: null,
    forecast: [] // [{ day, date, tempMax, tempMin, condition, rainProbability }, ...]
};

/* ---------------- DOM handles ---------------- */

const el = {
    locationForm: document.querySelector("#locationForm"),
    cityInput: document.querySelector("#cityInput"),
    locateBtn: document.querySelector("#locateBtn"),
    cityPill: document.querySelector("#pillCity"),

    snapshotData: document.querySelector("#snapshotData"),
    snapIcon: document.querySelector("#snapIcon"),
    snapTemp: document.querySelector("#snapTemp"),
    snapCondition: document.querySelector("#snapCondition"),
    snapFeels: document.querySelector("#snapFeels"),
    snapHumidity: document.querySelector("#snapHumidity"),
    snapWind: document.querySelector("#snapWind"),
    snapRain: document.querySelector("#snapRain"),

    forecastToggle: document.querySelector("#forecastToggle"),
    forecastStrip: document.querySelector("#forecastStrip"),

    chatLog: document.querySelector("#chatLog"),
    chatForm: document.querySelector("#chatForm"),
    chatInput: document.querySelector("#chatInput"),
    chatSend: document.querySelector("#chatSend")
};

/* ---------------- Weather lookup ---------------- */

el.locationForm.addEventListener("submit", function (event) {
    event.preventDefault();
    searchWeather();
});

async function searchWeather() {
    const city = el.cityInput.value.trim();
    if (!city) return;

    setLocating(true);

    try {
        const geo = await fetch(
            "https://geocoding-api.open-meteo.com/v1/search?name=" +
            encodeURIComponent(city) + "&count=1&language=en&format=json"
        );
        if (!geo.ok) throw new Error("Location lookup failed");
        const geoData = await geo.json();

        if (!geoData.results || geoData.results.length === 0) {
            addBotMessage("I couldn't find \"" + city + "\". Try a different spelling or a nearby larger city.");
            return;
        }

        const place = geoData.results[0];
        weatherContext.city = place.name || city;
        weatherContext.latitude = place.latitude;
        weatherContext.longitude = place.longitude;

        const weatherRes = await fetch(
            "https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude +
            "&longitude=" + place.longitude +
            "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,visibility,surface_pressure" +
            "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max" +
            "&forecast_days=7&timezone=auto"
        );
        if (!weatherRes.ok) throw new Error("Weather lookup failed");
        const weatherData = await weatherRes.json();
        if (!weatherData.current || !weatherData.daily) throw new Error("Incomplete weather data");

        applyWeatherData(weatherData);
        renderSnapshot();
        renderForecastStrip();
        el.cityPill.textContent = weatherContext.city;
        el.snapshotData.hidden = false;

        addBotMessage(
            "Got it — " + weatherContext.city + " is " + Math.round(weatherContext.temperature) +
            "°C and " + weatherContext.condition.toLowerCase() + " right now. Ask me anything about it."
        );
    } catch (err) {
        console.error("Weather error:", err);
        addBotMessage("Something went wrong fetching weather for \"" + city + "\". Please try again.");
    } finally {
        setLocating(false);
    }
}

function setLocating(isLoading) {
    el.locateBtn.disabled = isLoading;
    el.locateBtn.textContent = isLoading ? "Loading…" : "Get weather";
}

function applyWeatherData(data) {
    const c = data.current;
    weatherContext.temperature = c.temperature_2m;
    weatherContext.feelsLike = c.apparent_temperature;
    weatherContext.humidity = c.relative_humidity_2m;
    weatherContext.windSpeed = c.wind_speed_10m;
    weatherContext.visibility = c.visibility;
    weatherContext.pressure = c.surface_pressure;
    weatherContext.weatherCode = c.weather_code;
    weatherContext.condition = getWeatherCondition(c.weather_code);
    weatherContext.rainProbabilityToday = data.daily.precipitation_probability_max[0];

    weatherContext.forecast = data.daily.time.map(function (dateStr, i) {
        return {
            date: dateStr,
            day: i === 0 ? "Today" : i === 1 ? "Tomorrow" :
                new Date(dateStr).toLocaleDateString("en-US", { weekday: "short" }),
            tempMax: data.daily.temperature_2m_max[i],
            tempMin: data.daily.temperature_2m_min[i],
            condition: getWeatherCondition(data.daily.weather_code[i]),
            icon: getWeatherIcon(data.daily.weather_code[i]),
            rainProbability: data.daily.precipitation_probability_max[i]
        };
    });
}

function renderSnapshot() {
    el.snapIcon.textContent = getWeatherIcon(weatherContext.weatherCode);
    el.snapTemp.textContent = Math.round(weatherContext.temperature) + "°";
    el.snapCondition.textContent = weatherContext.condition;
    el.snapFeels.textContent = Math.round(weatherContext.feelsLike) + "°";
    el.snapHumidity.textContent = weatherContext.humidity + "%";
    el.snapWind.textContent = Math.round(weatherContext.windSpeed) + " km/h";
    el.snapRain.textContent = weatherContext.rainProbabilityToday + "%";
}

function renderForecastStrip() {
    el.forecastStrip.innerHTML = "";
    weatherContext.forecast.forEach(function (d) {
        const card = document.createElement("div");
        card.className = "forecast-day";
        card.innerHTML =
            '<div class="fd-label">' + d.day + '</div>' +
            '<div class="fd-icon">' + d.icon + '</div>' +
            '<div class="fd-temp">' + Math.round(d.tempMax) + '°/' + Math.round(d.tempMin) + '°</div>' +
            '<div class="fd-rain">' + d.rainProbability + '% rain</div>';
        el.forecastStrip.appendChild(card);
    });
}

el.forecastToggle.addEventListener("click", function () {
    const expanded = el.forecastToggle.getAttribute("aria-expanded") === "true";
    el.forecastToggle.setAttribute("aria-expanded", String(!expanded));
    el.forecastStrip.hidden = expanded;
});

/* ---------------- Weather code helpers ---------------- */

function getWeatherCondition(code) {
    if (code === 0) return "Clear Sky";
    if (code === 1 || code === 2) return "Partly Cloudy";
    if (code === 3) return "Overcast";
    if (code === 45 || code === 48) return "Foggy";
    if (code >= 51 && code <= 57) return "Drizzle";
    if (code >= 61 && code <= 67) return "Rain";
    if (code >= 71 && code <= 77) return "Snow";
    if (code >= 80 && code <= 82) return "Rain Showers";
    if (code >= 95) return "Thunderstorm";
    return "Unknown";
}

function getWeatherIcon(code) {
    if (code === 0) return "☀️";
    if (code === 1 || code === 2) return "🌤️";
    if (code === 3) return "☁️";
    if (code === 45 || code === 48) return "🌫️";
    if (code >= 51 && code <= 57) return "🌦️";
    if (code >= 61 && code <= 67) return "🌧️";
    if (code >= 71 && code <= 77) return "❄️";
    if (code >= 80 && code <= 82) return "🌧️";
    if (code >= 95) return "⛈️";
    return "🌤️";
}

/* ---------------- Chat ---------------- */

el.chatForm.addEventListener("submit", function (event) {
    event.preventDefault();
    askWeatherGPT();
});

async function askWeatherGPT() {
    const question = el.chatInput.value.trim();
    if (!question) return;

    addUserMessage(question);
    el.chatInput.value = "";

    if (!weatherContext.city) {
        addBotMessage("Search for a city above first, then ask me about its weather.");
        return;
    }

    const thinkingEl = addBotMessage("Thinking…", { thinking: true });
    setChatBusy(true);

    try {
        const answer = await callWeatherGPT(question, weatherContext);
        thinkingEl.querySelector("p").textContent = answer;
        thinkingEl.classList.remove("msg-thinking");
    } catch (err) {
        console.error("Chat error:", err);
        thinkingEl.querySelector("p").textContent =
            getFallbackAnswer(question, weatherContext);
        thinkingEl.classList.remove("msg-thinking");
    } finally {
        setChatBusy(false);
    }
}

function setChatBusy(isBusy) {
    el.chatSend.disabled = isBusy;
    el.chatInput.disabled = isBusy;
}

function addUserMessage(text) {
    return appendMessage(text, "msg-user");
}

function addBotMessage(text, opts) {
    const cls = opts && opts.thinking ? "msg-bot msg-thinking" : "msg-bot";
    return appendMessage(text, cls);
}

function appendMessage(text, className) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + className;
    const p = document.createElement("p");
    p.textContent = text;
    wrap.appendChild(p);
    el.chatLog.appendChild(wrap);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    return wrap;
}

/* ----------------------------------------------------------
   Answers questions using the fetched weather data.
   ----------------------------------------------------------
   This is a rule-based responder — no external API, no key,
   no backend needed. It's the whole point for a prototype:
   works instantly, offline-safe, nothing to deploy or pay for.

   If you later want real LLM reasoning (freeform questions,
   better language handling), wire this up to a backend that
   calls an LLM API — keep the key server-side, never in this
   file. For now this covers rain, temperature, humidity, wind,
   forecast, and activity questions ("wash my car", "go for a
   run", etc.) using a simple rain/wind heuristic.
   ---------------------------------------------------------- */

async function callWeatherGPT(question, context) {
    return getFallbackAnswer(question, context);
}

/* ----------------------------------------------------------
   Offline fallback — used if no API key is set, or the LLM
   call fails. Simple keyword matching so the demo still works.
   ---------------------------------------------------------- */

function getFallbackAnswer(question, ctx) {
    const q = question.toLowerCase();
    const isTamil = /[\u0B80-\u0BFF]/.test(question);
    const tomorrow = ctx.forecast[1] || {};

    if (isTamil) {
        if (q.includes("மழை")) {
            return ctx.city + " பகுதியில் இன்று மழை பெய்யும் வாய்ப்பு " + ctx.rainProbabilityToday + "% உள்ளது.";
        }
        if (q.includes("வெப்பநிலை")) {
            return ctx.city + " பகுதியில் தற்போதைய வெப்பநிலை " + Math.round(ctx.temperature) + "°C ஆக உள்ளது.";
        }
        return "நான் வானிலை, வெப்பநிலை, மழை, forecast பற்றிய தகவல்களை வழங்க முடியும்.";
    }

    if (q.includes("tomorrow") && q.includes("rain")) {
        return "There's a " + tomorrow.rainProbability + "% chance of rain in " + ctx.city + " tomorrow.";
    }
    if (q.includes("umbrella")) {
        return ctx.rainProbabilityToday >= 50
            ? "Yes, worth carrying an umbrella — " + ctx.rainProbabilityToday + "% chance of rain today in " + ctx.city + "."
            : "Probably won't need one — only " + ctx.rainProbabilityToday + "% chance of rain today in " + ctx.city + ".";
    }
    if (q.includes("rain")) {
        return "There's a " + ctx.rainProbabilityToday + "% chance of rain in " + ctx.city + " today.";
    }
    if (q.includes("temperature") || q.includes("hot") || q.includes("cold")) {
        return "It's currently " + Math.round(ctx.temperature) + "°C in " + ctx.city + ", feels like " + Math.round(ctx.feelsLike) + "°C.";
    }
    if (q.includes("humidity")) {
        return "Humidity in " + ctx.city + " is " + ctx.humidity + "% right now.";
    }
    if (q.includes("wind")) {
        return "Wind speed in " + ctx.city + " is " + Math.round(ctx.windSpeed) + " km/h.";
    }
    if (q.includes("forecast") || q.includes("week")) {
        return "Here's the week ahead for " + ctx.city + ": " +
            ctx.forecast.map(function (d) { return d.day + " " + Math.round(d.tempMax) + "°"; }).join(", ") + ".";
    }

    // Activity-style questions — rough heuristic based on rain chance & wind,
    // since there's no LLM reasoning available offline.
    const outdoorActivity =
        q.includes("wash") || q.includes("car") || q.includes("run") ||
        q.includes("jog") || q.includes("walk") || q.includes("laundry") ||
        q.includes("dry") || q.includes("picnic") || q.includes("outside") ||
        q.includes("outdoor") || q.includes("bike") || q.includes("cycle");

    if (outdoorActivity) {
        const rainy = ctx.rainProbabilityToday >= 40;
        const windy = ctx.windSpeed >= 25;
        if (rainy) {
            return "Probably not the best day — " + ctx.rainProbabilityToday + "% chance of rain in " + ctx.city + " today.";
        }
        if (windy) {
            return "Should be dry, but it's fairly windy (" + Math.round(ctx.windSpeed) + " km/h) in " + ctx.city + " today.";
        }
        return "Looks like a good window — only " + ctx.rainProbabilityToday + "% chance of rain in " + ctx.city + " today.";
    }

    return "I can tell you about current temperature, rain chances, humidity, wind, or the 7-day forecast for " + ctx.city + ".";
}

console.log("WeatherGPT loaded.");
