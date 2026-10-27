import "dotenv/config";
import express from "express";
import axios from "axios";

const app = express();
const port = 3000;

// The key lives in .env so it never gets pushed to GitHub.
const API_KEY = process.env.OPENWEATHER_API_KEY;
const GEO_URL = "https://api.openweathermap.org/geo/1.0/direct";
const FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast";

// OpenWeatherMap groups weather into "main" categories. These three all mean water falling from the sky.
const RAINY_CONDITIONS = ["Rain", "Drizzle", "Thunderstorm"];

app.use(express.static("public"));

// Home page: just the search form.
app.get("/", (req, res) => {
  res.render("index.ejs");
});

// The form sends the city here as a query string: /weather?city=London
app.get("/weather", async (req, res) => {
  const city = (req.query.city || "").trim();

  if (!city) {
    res.status(400).render("index.ejs", { error: "Please type a city name." });
    return;
  }

  if (!API_KEY) {
    console.error("OPENWEATHER_API_KEY is missing. Copy .env.example to .env and add your key.");
    res.status(500).render("index.ejs", {
      city: city,
      error: "The server is missing its weather API key.",
    });
    return;
  }

  try {
    // Step 1: turn the city name into coordinates.
    const geoResponse = await axios.get(GEO_URL, {
      params: { q: city, limit: 1, appid: API_KEY },
    });
    const places = geoResponse.data;

    if (places.length === 0) {
      res.status(404).render("index.ejs", {
        city: city,
        error: `We couldn't find a place called "${city}". Try adding the country, e.g. "Paris, FR".`,
      });
      return;
    }

    const place = places[0];

    // Step 2: ask for the 5-day forecast at those coordinates (one entry every 3 hours).
    const forecastResponse = await axios.get(FORECAST_URL, {
      params: { lat: place.lat, lon: place.lon, units: "metric", appid: API_KEY },
    });
    const forecast = forecastResponse.data;

    // Step 3: keep only tomorrow's entries and decide if any of them is rainy.
    const timezoneOffset = forecast.city.timezone;
    const tomorrow = getTomorrowDate(timezoneOffset);
    const tomorrowSlots = [];

    for (const entry of forecast.list) {
      const entryDate = toLocalDate(entry.dt, timezoneOffset);
      if (entryDate === tomorrow) {
        tomorrowSlots.push(toSlot(entry, timezoneOffset));
      }
    }

    let willRain = false;
    let highestChance = 0;
    for (const slot of tomorrowSlots) {
      if (slot.isRainy) {
        willRain = true;
      }
      if (slot.chance > highestChance) {
        highestChance = slot.chance;
      }
    }

    res.render("index.ejs", {
      city: city,
      placeName: formatPlaceName(place),
      tomorrow: tomorrow,
      willRain: willRain,
      highestChance: highestChance,
      slots: tomorrowSlots,
    });
  } catch (error) {
    const message = getUserMessage(error);
    console.error("Weather request failed:", error.response ? error.response.data : error.message);
    res.status(500).render("index.ejs", { city: city, error: message });
  }
});

// OpenWeatherMap gives the city's offset from UTC in seconds.
// Adding it to UTC and then reading the UTC fields gives the city's local date and time.
function getTomorrowDate(timezoneOffset) {
  const nowAtCity = new Date(Date.now() + timezoneOffset * 1000);
  nowAtCity.setUTCDate(nowAtCity.getUTCDate() + 1);
  return nowAtCity.toISOString().slice(0, 10);
}

function toLocalDate(unixSeconds, timezoneOffset) {
  const localTime = new Date((unixSeconds + timezoneOffset) * 1000);
  return localTime.toISOString().slice(0, 10);
}

function toLocalTime(unixSeconds, timezoneOffset) {
  const localTime = new Date((unixSeconds + timezoneOffset) * 1000);
  return localTime.toISOString().slice(11, 16);
}

// Picks out just the fields the page needs from one 3-hour forecast entry.
function toSlot(entry, timezoneOffset) {
  const condition = entry.weather[0];
  const rainAmount = entry.rain ? entry.rain["3h"] : 0;

  return {
    time: toLocalTime(entry.dt, timezoneOffset),
    description: condition.description,
    icon: condition.icon,
    temp: Math.round(entry.main.temp),
    chance: Math.round(entry.pop * 100),
    rainAmount: rainAmount,
    isRainy: RAINY_CONDITIONS.includes(condition.main) || rainAmount > 0,
  };
}

function formatPlaceName(place) {
  const parts = [place.name];
  if (place.state) {
    parts.push(place.state);
  }
  parts.push(place.country);
  return parts.join(", ");
}

// Turns an Axios error into something a user can act on.
function getUserMessage(error) {
  if (!error.response) {
    return "We couldn't reach the weather service. Check your internet connection and try again.";
  }

  const status = error.response.status;
  if (status === 401) {
    return "The weather API key was rejected. New keys can take a couple of hours to activate.";
  }
  if (status === 429) {
    return "Too many requests to the weather service. Please wait a minute and try again.";
  }
  return "The weather service had a problem. Please try again later.";
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
