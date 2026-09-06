async function searchWeather() {
    const searchButton = document.querySelector(".weather-search button");
searchButton.textContent = "Loading...";
searchButton.disabled = true;

    const input = document.querySelector(".weather-search input");
    const city = input.value.trim();

    if (city === "") {
    alert("Please enter a city name!");
    searchButton.textContent = "Search Weather";
    searchButton.disabled = false;
    return;

    }

    try {
        const locationResponse = await fetch(
            "https://geocoding-api.open-meteo.com/v1/search?name=" +
            encodeURIComponent(city) +
            "&count=1&language=en&format=json"
        );

        if (!locationResponse.ok) {
            throw new Error("Location API error");
        }

        const locationData = await locationResponse.json();

       if (!locationData.results || locationData.results.length === 0) {
    alert("City not found!");

    searchButton.textContent = "Search Weather";
    searchButton.disabled = false;

    return;
}


        const location = locationData.results[0];

        const latitude = location.latitude;
        const longitude = location.longitude;
        const actualCityName = location.name || city;

        const weatherResponse = await fetch(
            "https://api.open-meteo.com/v1/forecast?" +
            "latitude=" + latitude +
            "&longitude=" + longitude +
            "&current=" +
            "temperature_2m," +
            "relative_humidity_2m," +
            "wind_speed_10m," +
            "weather_code," +
            "apparent_temperature," +
            "visibility," +
            "surface_pressure" +
            "&timezone=auto"
        );

        if (!weatherResponse.ok) {
            throw new Error("Weather API error");
        }

        const weatherData = await weatherResponse.json();

        if (!weatherData.current) {
            throw new Error("Current weather data unavailable");
        }

        const current = weatherData.current;

        const temperature = current.temperature_2m;
        const humidity = current.relative_humidity_2m;
        const windSpeed = current.wind_speed_10m;
        const feelsLike = current.apparent_temperature;
        const weatherCode = current.weather_code;
        const visibility = current.visibility;
        const pressure = current.surface_pressure;

        window.currentTemperature = temperature;
        window.currentHumidity = humidity;
        window.currentWindSpeed = windSpeed;
        window.currentFeelsLike = feelsLike;
        window.currentCity = actualCityName;
        window.currentWeatherCode = weatherCode;


        const condition = getWeatherCondition(weatherCode);

        document.querySelector("#cityName").textContent = actualCityName;
        document.querySelector("#temperature").textContent = temperature + "°C";
        document.querySelector("#condition").textContent = condition;
        document.querySelector("#humidity").textContent = humidity + "%";
        document.querySelector("#windSpeed").textContent = windSpeed + " km/h";
        document.querySelector("#feelsLike").textContent = feelsLike + "°C";

        if (visibility !== undefined && visibility !== null) {
            document.querySelector("#visibility").textContent =
                (visibility / 1000).toFixed(1) + " km";
        } else {
            document.querySelector("#visibility").textContent = "-- km";
        }

        if (pressure !== undefined && pressure !== null) {
            document.querySelector("#pressure").textContent =
                Math.round(pressure) + " hPa";
        } else {
            document.querySelector("#pressure").textContent = "-- hPa";
        }

        await getForecast(latitude, longitude);
       updateWeatherRisk();




        updateWeatherAlert(weatherCode, actualCityName);

    
    } catch (error) {
        console.error("Weather Error:", error);
        alert("Unable to get weather data. Please try again.");
    } finally {
        searchButton.textContent = "Search Weather";
        searchButton.disabled = false;
    }
}



async function getForecast(latitude, longitude) {
    try {
        const response = await fetch(
            "https://api.open-meteo.com/v1/forecast?" +
            "latitude=" + latitude +
            "&longitude=" + longitude +
            "&daily=" +
            "temperature_2m_max," +
            "temperature_2m_min," +
            "weather_code," +
            "precipitation_probability_max" +
            "&forecast_days=7" +
            "&timezone=auto"
        );

        if (!response.ok) {
            throw new Error("Forecast API error");
        }

        const data = await response.json();

        if (!data.daily) {
            throw new Error("Forecast data unavailable");
        }

        window.tomorrowMaxTemperature =
            data.daily.temperature_2m_max[1];

        window.tomorrowRainProbability =
            data.daily.precipitation_probability_max[1];

        const rainProbability =
            data.daily.precipitation_probability_max[0];

        window.currentRainProbability =
            rainProbability;

        document.querySelector("#rainAlert").textContent =
            "Rain Probability: " + rainProbability + "%";

        updateRainAlertLevel(rainProbability);

        for (let i = 0; i < 7; i++) {
            const forecastDate = new Date(data.daily.time[i]);

            const dayElement =
                document.querySelector("#day" + (i + 1));

            const tempElement =
                document.querySelector("#temp" + (i + 1));

            const conditionElement =
                document.querySelector("#condition" + (i + 1));

            const iconElement =
                document.querySelector("#icon" + (i + 1));

            const rainElement =
                document.querySelector("#rain" + (i + 1));

            if (dayElement) {
                if (i === 0) {
                    dayElement.textContent = "Today";
                } else if (i === 1) {
                    dayElement.textContent = "Tomorrow";
                } else {
                    dayElement.textContent =
                        forecastDate.toLocaleDateString("en-US", {
                            weekday: "short"
                        });
                }
            }

            if (tempElement) {
                tempElement.textContent =
                    data.daily.temperature_2m_max[i] + "°C";
            }

            const condition =
                getWeatherCondition(data.daily.weather_code[i]);

            if (conditionElement) {
                conditionElement.textContent = condition;
            }

            const icon =
                getWeatherIcon(data.daily.weather_code[i]);

            if (iconElement) {
                iconElement.textContent = icon;
            }

            const dailyRain =
                data.daily.precipitation_probability_max[i];

            if (rainElement) {
                rainElement.textContent =
                    "Rain: " + dailyRain + "%";
            }
        }

    } catch (error) {
        console.error("Forecast Error:", error);

        document.querySelector("#rainAlert").textContent =
            "Rain Probability: --%";
    }
}


function getWeatherCondition(code) {
    if (code === 0) return "Clear Sky";
    if (code === 1 || code === 2 || code === 3) return "Partly Cloudy";
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


function updateRainAlertLevel(rainProbability) {
    const alertLevelElement = document.querySelector("#alertLevel");

    if (!alertLevelElement) {
        return;
    }

    let alertLevel = "Normal";

    if (rainProbability >= 81) {
        alertLevel = "Very High";
        alertLevelElement.style.backgroundColor = "#f8d7da";
        alertLevelElement.style.color = "#842029";

    } else if (rainProbability >= 61) {
        alertLevel = "High";
        alertLevelElement.style.backgroundColor = "#fff3cd";
        alertLevelElement.style.color = "#664d03";

    } else if (rainProbability >= 31) {
        alertLevel = "Moderate";
        alertLevelElement.style.backgroundColor = "#cff4fc";
        alertLevelElement.style.color = "#055160";

    } else {
        alertLevel = "Normal";
        alertLevelElement.style.backgroundColor = "#d1e7dd";
        alertLevelElement.style.color = "#0f5132";
    }

    alertLevelElement.textContent =
        "Alert Level: " + alertLevel;
}



function updateWeatherAlert(weatherCode, city) {

    const alertTitle =
        document.querySelector("#alertTitle");

    const alertMessage =
        document.querySelector("#alertMessage");

    const alertIcon =
        document.querySelector(".alert-icon");

    const rainProbability =
        window.currentRainProbability;

    if (!alertTitle || !alertMessage) {
        return;
    }

    if (rainProbability >= 80) {

        alertTitle.textContent =
            "🌧️ Heavy Rain Alert";

        alertMessage.textContent =
            "Very high rain probability of " +
            rainProbability +
            "% is expected in " +
            city +
            ". Carry an umbrella and avoid unnecessary travel.";

        if (alertIcon) {
            alertIcon.textContent = "⚠️";
        }

    } else if (weatherCode >= 95) {

        alertTitle.textContent =
            "⛈️ Severe Weather Alert";

        alertMessage.textContent =
            "Thunderstorm conditions are currently detected in " +
            city +
            ". Please stay alert and follow local weather guidance.";

        if (alertIcon) {
            alertIcon.textContent = "⚠️";
        }

    } else if (rainProbability >= 50) {

        alertTitle.textContent =
            "🌦️ Rain Possibility";

        alertMessage.textContent =
            "There is a " +
            rainProbability +
            "% chance of rain in " +
            city +
            " today. Consider carrying an umbrella.";

        if (alertIcon) {
            alertIcon.textContent = "⚠️";
        }

    } else {

        alertTitle.textContent =
            "✅ No Active Alerts";

        alertMessage.textContent =
            "There are currently no severe weather alerts for " +
            city +
            ".";

        if (alertIcon) {
            alertIcon.textContent = "✅";
        }
    }
}



function askWeatherGPT() {
    const input =
        document.querySelector("#chatInput");

    const question =
        input.value.trim();

    if (question === "") {
        alert("Please ask a question!");
        return;
    }

    if (!window.currentCity) {
        document.querySelector("#chatResponse").textContent =
            "Please search for a city first, then ask me about its weather.";
        return;
    }

    const lowerQuestion =
        question.toLowerCase();

    const isTamil =
        /[\u0B80-\u0BFF]/.test(question);

    const city =
        window.currentCity;

    const temperature =
        window.currentTemperature;

    const humidity =
        window.currentHumidity;

    const windSpeed =
        window.currentWindSpeed;

    const feelsLike =
        window.currentFeelsLike;

    const rainProbability =
        window.currentRainProbability;

    const tomorrowRain =
        window.tomorrowRainProbability;

    const tomorrowTemperature =
        window.tomorrowMaxTemperature;

    const condition =
        document.querySelector("#condition").textContent;

    let answer = "";

    if (isTamil) {

        if (
            lowerQuestion.includes("நாளைக்கு") &&
            lowerQuestion.includes("மழை")
        ) {
            if (tomorrowRain >= 70) {
                answer =
                    city +
                    " பகுதியில் நாளைக்கு மழை பெய்யும் வாய்ப்பு " +
                    tomorrowRain +
                    "% உள்ளது. குடை எடுத்துச் செல்வது நல்லது.";
            } else {
                answer =
                    city +
                    " பகுதியில் நாளைக்கு மழை பெய்யும் வாய்ப்பு " +
                    tomorrowRain +
                    "% மட்டுமே உள்ளது.";
            }

        } else if (
            lowerQuestion.includes("நாளைக்கு") &&
            lowerQuestion.includes("வெப்பநிலை")
        ) {
            answer =
                city +
                " பகுதியில் நாளைய அதிகபட்ச வெப்பநிலை " +
                tomorrowTemperature +
                "°C ஆக இருக்கும்.";

        } else if (
            lowerQuestion.includes("எச்சரிக்கை")
        ) {
            answer =
                city +
                " பகுதிக்கான தற்போதைய வானிலை எச்சரிக்கைகள் மேலே உள்ள Weather Alerts பகுதியில் காட்டப்பட்டுள்ளன.";

        } else if (
            lowerQuestion.includes("ஈரப்பதம்")
        ) {
            answer =
                city +
                " பகுதியில் தற்போதைய ஈரப்பதம் " +
                humidity +
                "% ஆக உள்ளது.";

        } else if (
            lowerQuestion.includes("காற்று")
        ) {
            answer =
                city +
                " பகுதியில் தற்போதைய காற்றின் வேகம் " +
                windSpeed +
                " km/h ஆக உள்ளது.";

        } else if (
            lowerQuestion.includes("வெப்பநிலை")
        ) {
            answer =
                city +
                " பகுதியில் தற்போதைய வெப்பநிலை " +
                temperature +
                "°C ஆக உள்ளது.";

        } else if (
            lowerQuestion.includes("மழை")
        ) {
            answer =
                city +
                " பகுதியில் இன்று மழை பெய்யும் வாய்ப்பு " +
                rainProbability +
                "% உள்ளது.";

        } else if (
            lowerQuestion.includes("வானிலை")
        ) {
            answer =
                "இன்று " +
                city +
                " வானிலை " +
                temperature +
                "°C மற்றும் " +
                getTamilCondition(condition) +
                " நிலையில் உள்ளது.";

        } else {
            answer =
                "நான் வானிலை, வெப்பநிலை, மழை, காற்று, ஈரப்பதம், forecast மற்றும் alerts பற்றிய தகவல்களை வழங்க முடியும்.";
        }

    } else {

        if (
            lowerQuestion.includes("tomorrow") &&
            lowerQuestion.includes("rain")
        ) {
            if (tomorrowRain >= 70) {
                answer =
                    "There is a " +
                    tomorrowRain +
                    "% chance of rain in " +
                    city +
                    " tomorrow. Carrying an umbrella would be a good idea.";
            } else {
                answer =
                    "There is a " +
                    tomorrowRain +
                    "% chance of rain in " +
                    city +
                    " tomorrow. The chance of rain is relatively low.";
            }

        } else if (
            lowerQuestion.includes("umbrella") &&
            lowerQuestion.includes("tomorrow")
        ) {
            if (tomorrowRain >= 50) {
                answer =
                    "Yes, carrying an umbrella would be a good idea tomorrow in " +
                    city +
                    " because there is a " +
                    tomorrowRain +
                    "% chance of rain.";
            } else {
                answer =
                    "You probably won't need an umbrella tomorrow in " +
                    city +
                    " because the chance of rain is only " +
                    tomorrowRain +
                    "%.";
            }

        } else if (
            lowerQuestion.includes("tomorrow") &&
            lowerQuestion.includes("weather")
        ) {
            answer =
                "Tomorrow's weather in " +
                city +
                " is expected to reach a maximum temperature of " +
                tomorrowTemperature +
                "°C, with a " +
                tomorrowRain +
                "% chance of rain.";

        } else if (
            lowerQuestion.includes("tomorrow") &&
            lowerQuestion.includes("temperature")
        ) {
            answer =
                "Tomorrow's maximum temperature in " +
                city +
                " is expected to be " +
                tomorrowTemperature +
                "°C.";

        } else if (
            lowerQuestion.includes("feels like") ||
            lowerQuestion.includes("feel like") ||
            lowerQuestion.includes("outside")
        ) {
            answer =
                "It feels like " +
                feelsLike +
                "°C in " +
                city +
                " right now.";

        } else if (
            lowerQuestion.includes("humidity")
        ) {
            answer =
                "The current humidity in " +
                city +
                " is " +
                humidity +
                "%.";

        } else if (
            lowerQuestion.includes("wind")
        ) {
            answer =
                "The current wind speed in " +
                city +
                " is " +
                windSpeed +
                " km/h.";

        } else if (
            lowerQuestion.includes("umbrella")
        ) {
            if (rainProbability >= 50) {
                answer =
                    "Carrying an umbrella would be a good idea today in " +
                    city +
                    " because there is a " +
                    rainProbability +
                    "% chance of rain.";
            } else {
                answer =
                    "You probably won't need an umbrella today in " +
                    city +
                    " because the chance of rain is only " +
                    rainProbability +
                    "%.";
            }

        } else if (
            lowerQuestion.includes("rain")
        ) {
            answer =
                "There is a " +
                rainProbability +
                "% chance of rain in " +
                city +
                " today.";

        } else if (
            lowerQuestion.includes("temperature")
        ) {
            answer =
                "The current temperature in " +
                city +
                " is " +
                temperature +
                "°C.";

        } else if (
            lowerQuestion.includes("alert")
        ) {
            answer =
                "Current weather alerts for " +
                city +
                " are shown in the Weather Alerts section above.";

        } else if (
            lowerQuestion.includes("forecast")
        ) {
            answer =
                "Here is the 7-day weather forecast for " +
                city +
                ". You can view the daily temperature, weather condition and rain probability above.";

        } else if (
            lowerQuestion.includes("climate")
        ) {
            answer =
                "Climate describes the long-term weather patterns of a region over many years, while weather describes short-term atmospheric conditions.";

        } else if (
            lowerQuestion.includes("weather") ||
            lowerQuestion.includes("today")
        ) {
            answer =
                "The current weather in " +
                city +
                " is " +
                temperature +
                "°C with " +
                condition +
                " conditions. Humidity is " +
                humidity +
                "% and wind speed is " +
                windSpeed +
                " km/h.";

        } else {
            answer =
                "I can help you with current weather, temperature, rain, humidity, wind, forecasts, alerts and climate information.";
        }
    }

    document.querySelector("#chatResponse").textContent =
        answer;

    input.value = "";
}


function getTamilCondition(condition) {
    if (condition === "Clear Sky")
        return "தெளிவான வானிலை";

    if (condition === "Partly Cloudy")
        return "பகுதியளவு மேகமூட்டம்";

    if (condition === "Foggy")
        return "பனிமூட்டம்";

    if (condition === "Drizzle")
        return "தூறல்";

    if (condition === "Rain")
        return "மழை";

    if (condition === "Rain Showers")
        return "மழைச் சாரல்";

    if (condition === "Thunderstorm")
        return "இடியுடன் கூடிய மழை";

    if (condition === "Snow")
        return "பனிப்பொழிவு";

    return "வானிலை";
}


document
    .querySelector(".weather-search input")
    .addEventListener("keydown", function(event) {
        if (event.key === "Enter") {
            searchWeather();
        }
    });


document
    .querySelector("#chatInput")
    .addEventListener("keydown", function(event) {
        if (event.key === "Enter") {
            askWeatherGPT();
        }
    });
function updateWeatherRisk() {
    const feelsLike = window.currentFeelsLike;
    const rainProbability = window.currentRainProbability;
    const weatherCode = window.currentWeatherCode;

    const heatRiskElement = document.querySelector("#heatRisk");
    const rainRiskElement = document.querySelector("#rainRisk");
    const stormRiskElement = document.querySelector("#stormRisk");
    const travelRiskElement = document.querySelector("#travelRisk");
    const recommendationElement =
        document.querySelector("#safetyRecommendation");

    if (!heatRiskElement || !rainRiskElement ||
        !stormRiskElement || !travelRiskElement ||
        !recommendationElement) {
        return;
    }

    let heatRisk = "Low";
    let rainRisk = "Low";
    let stormRisk = "Low";
    let travelRisk = "Low";

    if (feelsLike >= 40) {
        heatRisk = "Very High";
    } else if (feelsLike >= 35) {
        heatRisk = "High";
    } else if (feelsLike >= 32) {
        heatRisk = "Moderate";
    }

    if (rainProbability >= 80) {
        rainRisk = "Very High";
    } else if (rainProbability >= 60) {
        rainRisk = "High";
    } else if (rainProbability >= 30) {
        rainRisk = "Moderate";
    }

    if (weatherCode >= 95) {
        stormRisk = "Very High";
    } else if (weatherCode >= 80 && weatherCode <= 82) {
        stormRisk = "High";
    } else if (weatherCode >= 61 && weatherCode <= 67) {
        stormRisk = "Moderate";
    }

    if (
        heatRisk === "Very High" ||
        rainRisk === "Very High" ||
        stormRisk === "Very High"
    ) {
        travelRisk = "High";
    } else if (
        heatRisk === "High" ||
        rainRisk === "High" ||
        stormRisk === "High"
    ) {
        travelRisk = "Moderate";
    }

    heatRiskElement.textContent = heatRisk;
    rainRiskElement.textContent = rainRisk;
    stormRiskElement.textContent = stormRisk;
    travelRiskElement.textContent = travelRisk;

    if (stormRisk === "Very High") {
        recommendationElement.textContent =
            "Thunderstorm conditions detected. Stay indoors, avoid open areas and follow local weather warnings.";
    } else if (heatRisk === "Very High") {
        recommendationElement.textContent =
            "Extreme heat conditions detected. Stay hydrated, avoid prolonged outdoor activities and seek shade.";
    } else if (rainRisk === "Very High") {
        recommendationElement.textContent =
            "Very high rain probability detected. Carry an umbrella, avoid unnecessary travel and watch for waterlogged areas.";
    } else if (stormRisk === "High") {
        recommendationElement.textContent =
            "Unstable weather conditions detected. Avoid exposed outdoor areas and monitor weather updates.";
    } else if (heatRisk === "High") {
        recommendationElement.textContent =
            "High heat stress is possible. Stay hydrated and avoid strenuous outdoor activities during peak heat.";
    } else if (rainRisk === "High") {
        recommendationElement.textContent =
            "High rain probability detected. Carry an umbrella and use caution while travelling.";
    } else {
        recommendationElement.textContent =
            "Current weather conditions appear relatively safe. Continue monitoring the forecast for changes.";
    }

    applyRiskColor(heatRiskElement, heatRisk);
    applyRiskColor(rainRiskElement, rainRisk);
    applyRiskColor(stormRiskElement, stormRisk);
    applyRiskColor(travelRiskElement, travelRisk);
}


console.log("WeatherGPT JavaScript loaded successfully!");

function applyRiskColor(element, level) {
    if (level === "Very High") {
        element.style.backgroundColor = "#f8d7da";
        element.style.color = "#842029";
    } else if (level === "High") {
        element.style.backgroundColor = "#fff3cd";
        element.style.color = "#664d03";
    } else if (level === "Moderate") {
        element.style.backgroundColor = "#cff4fc";
        element.style.color = "#055160";
    } else {
        element.style.backgroundColor = "#d1e7dd";
        element.style.color = "#0f5132";
    }
}
