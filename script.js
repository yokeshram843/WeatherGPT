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
    placePicker: document.querySelector("#placePicker"),
    snapIcon: document.querySelector("#snapIcon"),
    snapTemp: document.querySelector("#snapTemp"),
    snapCondition: document.querySelector("#snapCondition"),
    snapFeels: document.querySelector("#snapFeels"),
    snapHumidity: document.querySelector("#snapHumidity"),
    snapWind: document.querySelector("#snapWind"),
    snapRain: document.querySelector("#snapRain"),

    forecastStrip: document.querySelector("#forecastStrip"),

    windySection: document.querySelector("#windySection"),
    windyFrame: document.querySelector("#windyFrame"),
    windyFrameWrap: document.querySelector("#windyFrameWrap"),
    windyFullscreen: document.querySelector("#windyFullscreen"),
    emptyState: document.querySelector("#emptyState"),
    chatSuggestions: document.querySelector("#chatSuggestions"),

    chatLog: document.querySelector("#chatLog"),
    chatForm: document.querySelector("#chatForm"),
    chatInput: document.querySelector("#chatInput"),
    chatSend: document.querySelector("#chatSend"),

    chatFab: document.querySelector("#chatFab"),
    chatOverlay: document.querySelector("#chatOverlay"),
    chatClose: document.querySelector("#chatClose")
};

/* ---------------- Floating chat open/close ---------------- */

el.chatFab.addEventListener("click", function () {
    openChat();
});

el.chatClose.addEventListener("click", function () {
    closeChat();
});

el.chatOverlay.addEventListener("click", function (event) {
    if (event.target === el.chatOverlay) closeChat();
});

document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !el.chatOverlay.hidden) closeChat();
});

function openChat() {
    el.chatOverlay.hidden = false;
    el.chatFab.setAttribute("aria-expanded", "true");
    el.chatFab.classList.add("chat-fab-hidden");
    el.chatFab.classList.remove("chat-fab-unread");
    el.chatInput.focus();
}

function closeChat() {
    el.chatOverlay.hidden = true;
    el.chatFab.setAttribute("aria-expanded", "false");
    el.chatFab.classList.remove("chat-fab-hidden");
}

/* ---------------- Weather lookup ---------------- */

el.locationForm.addEventListener("submit", function (event) {
    event.preventDefault();
    searchWeather();
});

document.querySelectorAll(".example-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
        el.cityInput.value = chip.dataset.city;
        searchWeather();
    });
});

el.chatSuggestions.querySelectorAll(".suggestion-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
        el.chatInput.value = chip.dataset.question;
        askWeatherGPT();
    });
});

el.windyFullscreen.addEventListener("click", function () {
    const el_ = el.windyFrameWrap;
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else if (el_.requestFullscreen) {
        el_.requestFullscreen();
    } else if (el_.webkitRequestFullscreen) {
        // Safari (desktop + iOS Safari 16.4+)
        el_.webkitRequestFullscreen();
    }
});

async function searchWeather() {
    const city = el.cityInput.value.trim();
    if (!city) return;

    setLocating(true);
    el.forecastStrip.hidden = true;
    el.placePicker.hidden = true;
    el.placePicker.innerHTML = "";

    try {
        const candidates = await geocodePlace(city);

        if (candidates.length === 0) {
            addBotMessage("I couldn't find \"" + city + "\". Try a nearby town, taluk, or district name instead.");
            return;
        }

        if (candidates.length === 1) {
            await loadWeatherForPlace(candidates[0]);
        } else {
            showPlacePicker(city, candidates);
        }
    } catch (err) {
        console.error("Weather error:", err);
        addBotMessage("Something went wrong fetching weather for \"" + city + "\". Please try again.");
    } finally {
        setLocating(false);
    }
}

/* ----------------------------------------------------------
   Geocoding — name to coordinates.
   ----------------------------------------------------------
   Uses Nominatim (OpenStreetMap) instead of Open-Meteo's own
   geocoder. Open-Meteo's geocoder is backed by GeoNames, which
   has good city coverage but is thin on small villages —
   especially in India. Nominatim is built from OpenStreetMap
   contributions and has noticeably denser rural coverage, so
   a search like "Pushpavanam" is far more likely to resolve.
   Free, no API key required. Weather data itself still comes
   from Open-Meteo — only this lookup step changed.
   ---------------------------------------------------------- */

async function geocodePlace(query) {
    const res = await fetch(
        "https://nominatim.openstreetmap.org/search?q=" +
        encodeURIComponent(query) +
        "&format=json&addressdetails=1&limit=8"
    );
    if (!res.ok) throw new Error("Location lookup failed");
    const results = await res.json();

    const mapped = results.map(function (r) {
        const addr = r.address || {};
        // Prefer the most specific name available (village > town > city),
        // falling back to whatever Nominatim used as the primary label.
        const name = addr.village || addr.town || addr.city || addr.hamlet ||
            addr.suburb || r.name || query;

        const region = [addr.state_district, addr.state]
            .filter(Boolean)
            .join(", ");

        return {
            name: name,
            label: r.display_name,
            region: region,
            latitude: parseFloat(r.lat),
            longitude: parseFloat(r.lon)
        };
    });

    return dedupePlaces(mapped);
}

/* Nominatim often returns the same place several times (a village node,
   its boundary relation, a nearby post office, etc). Offering the user
   two identical-looking options is worse than useless, so collapse
   entries that share a name+region or that sit within ~15km of each
   other — at that distance the weather is the same anyway. */

function dedupePlaces(places) {
    const kept = [];

    places.forEach(function (place) {
        const duplicate = kept.some(function (existing) {
            const sameText =
                existing.name.toLowerCase() === place.name.toLowerCase() &&
                existing.region.toLowerCase() === place.region.toLowerCase();

            return sameText || distanceKm(existing, place) < 15;
        });

        if (!duplicate) kept.push(place);
    });

    return kept;
}

function distanceKm(a, b) {
    const R = 6371;
    const toRad = function (deg) { return deg * Math.PI / 180; };
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);

    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

    return 2 * R * Math.asin(Math.sqrt(h));
}

async function loadWeatherForPlace(place) {
    weatherContext.city = place.name;
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
    updateWindyMap(place.latitude, place.longitude);

    addBotMessage(
        "Got it — " + weatherContext.city + " is " + Math.round(weatherContext.temperature) +
        "°C and " + weatherContext.condition.toLowerCase() + " right now. Ask me anything about it."
    );
}

/* ----------------------------------------------------------
   Windy embed — no API key needed for the basic iframe embed.
   Centers Windy's interactive wind map on the searched
   location with a marker, wind overlay by default.
   ---------------------------------------------------------- */

function updateWindyMap(latitude, longitude) {
    const params = new URLSearchParams({
        lat: latitude,
        lon: longitude,
        detailLat: latitude,
        detailLon: longitude,
        zoom: "9",
        level: "surface",
        overlay: "wind",
        product: "ecmwf",
        marker: "true",
        calendar: "now",
        type: "map",
        location: "coordinates",
        metricWind: "km/h",
        metricTemp: "°C"
    });

    el.windyFrame.src = "https://embed.windy.com/embed2.html?" + params.toString();
    el.windySection.hidden = false;
    el.emptyState.hidden = true;
}

function showPlacePicker(query, candidates) {
    el.placePicker.innerHTML = "";

    const label = document.createElement("p");
    label.className = "picker-label";
    label.textContent = "Multiple matches for \"" + query + "\" — pick one:";
    el.placePicker.appendChild(label);

    const list = document.createElement("div");
    list.className = "picker-list";

    candidates.slice(0, 4).forEach(function (place) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "picker-option";
        btn.innerHTML =
            '<span class="picker-name">' + place.name + '</span>' +
            (place.region ? '<span class="picker-region">' + place.region + '</span>' : '');

        btn.addEventListener("click", async function () {
            list.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
            setLocating(true);
            try {
                await loadWeatherForPlace(place);
                el.placePicker.hidden = true;
                el.placePicker.innerHTML = "";
            } catch (err) {
                console.error("Weather error:", err);
                addBotMessage("Something went wrong fetching weather for " + place.name + ". Please try again.");
            } finally {
                setLocating(false);
            }
        });

        list.appendChild(btn);
    });

    el.placePicker.appendChild(list);
    el.placePicker.hidden = false;
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
    el.forecastStrip.hidden = false;
}

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

    el.chatSuggestions.hidden = true;
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
    if (el.chatOverlay.hidden) el.chatFab.classList.add("chat-fab-unread");
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
